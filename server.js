const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Папка со статикой (index.html, css/js)
app.use(express.static(path.join(__dirname, 'public')));

// Для проверки
app.get('/ping', (req, res) => {
  res.send('Server is running!');
});

// ------------------ ДАННЫЕ НА СЕРВЕРЕ ------------------

// очередь ожидания: хранит socket.id, ждущий собеседника
let waitingUser = null;

// Пары пользователей { socketId: partnerSocketId }
const userPairs = {};

// Информация о пользователях { socketId: { nickname, gender, age } }
const userData = {};

// Лог всех сообщений: массив объектов { from, to, text, timestamp }
const chatLogs = [];

// ------------------ ЛОГИКА SOCKET.IO -------------------

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // 1. Сохраняем пустой профиль по умолчанию
  userData[socket.id] = {
    nickname: null,
    gender: null,
    age: null
  };

  // Когда пользователь отправил свой профиль
  socket.on('setProfile', (profile) => {
    userData[socket.id].nickname = profile.nickname;
    userData[socket.id].gender = profile.gender;
    userData[socket.id].age = profile.age;
    console.log(`Profile set for ${socket.id}:`, userData[socket.id]);
    // После установки профиля — пытаемся найти пару
    matchOrWait(socket);
  });

  // Когда пользователь отправляет сообщение
  socket.on('sendMessage', (message) => {
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      // Сохраним в общий лог
      chatLogs.push({
        from: socket.id,
        to: partnerId,
        text: message,
        timestamp: Date.now()
      });

      // Пересылаем партнёру
      io.to(partnerId).emit('receiveMessage', {
        text: message
      });
    }
  });

  // Когда пользователь нажимает «следующий»
  socket.on('skip', () => {
    // Закрываем текущий чат, если он есть
    endChat(socket.id, true);
    // Ставим обратно в очередь
    matchOrWait(socket);
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Удалим из очереди, если был в очереди
    if (waitingUser === socket.id) {
      waitingUser = null;
    }
    // Завершаем чат с партнёром (если был)
    endChat(socket.id, false);
    // Удаляем профиль
    delete userData[socket.id];
  });
});

// ------------------ ФУНКЦИИ -------------------

// Функция: ставим сокет в очередь или мэчим с кем-то
function matchOrWait(socket) {
  // если никого нет в очереди
  if (!waitingUser) {
    waitingUser = socket.id;
    console.log(`Socket ${socket.id} is now waiting`);
  } else {
    // кто-то уже ждет — создаём пару
    const partnerId = waitingUser;
    waitingUser = null;

    userPairs[socket.id] = partnerId;
    userPairs[partnerId] = socket.id;

    // Посылаем обоим, что чат готов, а также профиль собеседника
    const myProfile = userData[socket.id];
    const partnerProfile = userData[partnerId];

    io.to(socket.id).emit('chatReady', {
      partnerId,
      partnerProfile
    });
    io.to(partnerId).emit('chatReady', {
      partnerId: socket.id,
      partnerProfile: myProfile
    });

    console.log(`Socket ${socket.id} matched with ${partnerId}`);
  }
}

// Функция: разрывает чат у userId и его партнёра
// if skip=true — значит userId решил найти другого собеседника
function endChat(userId, skip) {
  const partnerId = userPairs[userId];
  if (partnerId) {
    // партнёру скажем, что собеседник вышел
    io.to(partnerId).emit('partnerLeft');
    // очистим связи
    delete userPairs[partnerId];
    delete userPairs[userId];
    console.log(`Chat ended between ${userId} and ${partnerId}`);
    // Если skip=true, то партнёра стоит отправить в очередь или нет — решайте по логике
    // Здесь просто сообщаем, что он остался без собеседника
    // Если хотите, чтобы он тоже сразу искал нового — можно вызвать matchOrWait(партнёр).
  }
}

// ------------------ ЗАПУСК СЕРВЕРА -------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
