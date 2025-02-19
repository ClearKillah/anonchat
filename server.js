const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Инициализируем Express
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Список ожидающих пользователей
let waitingUser = null;

// Словарь { socketId: partnerSocketId }
const userPairs = {};

// Статические файлы (Frontend) — папка public
app.use(express.static(path.join(__dirname, 'public')));

// Маршрут для проверки работы
app.get('/ping', (req, res) => {
  res.send('Server is running!');
});

// Логика Socket.io
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // При подключении сокета проверяем, есть ли кто-то в очереди
  if (!waitingUser) {
    // Если никого нет, ставим в очередь
    waitingUser = socket.id;
    console.log(`Socket ${socket.id} is now waiting`);
  } else {
    // Если кто-то уже ждет, создаём пару
    userPairs[socket.id] = waitingUser;
    userPairs[waitingUser] = socket.id;

    // Посылаем обоим уведомление об успешном коннекте
    io.to(socket.id).emit('chatReady', { partner: waitingUser });
    io.to(waitingUser).emit('chatReady', { partner: socket.id });

    console.log(`Socket ${socket.id} matched with ${waitingUser}`);
    // Очищаем очередь
    waitingUser = null;
  }

  // Обработка входящих сообщений
  socket.on('sendMessage', (message) => {
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('receiveMessage', { text: message });
    }
  });

  // Обработка отключения
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Если пользователь был в очереди, очистим очередь
    if (waitingUser === socket.id) {
      waitingUser = null;
    }

    // Если пользователь был в паре, оповестим второго
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      // Уведомим второго пользователя, что чат закончился
      io.to(partnerId).emit('partnerLeft');
      // Удалим связи
      delete userPairs[partnerId];
      delete userPairs[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

