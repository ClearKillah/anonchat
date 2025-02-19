const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // Подключаем sqlite3

// Инициализация Express/Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаём статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Тестовый маршрут
app.get('/ping', (req, res) => {
  res.send('Server is running!');
});

// ------------------ ПОДКЛЮЧЕНИЕ К SQLite ------------------
const db = new sqlite3.Database('./chat.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к SQLite:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Создаём таблицы, если не существуют
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    socket_id TEXT PRIMARY KEY,
    nickname TEXT,
    gender TEXT,
    age INTEGER,
    connected_at INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_socket TEXT,
    to_socket TEXT,
    message TEXT,
    timestamp INTEGER
  )
`);

// ------------------ ВСПОМОГАТЕЛЬНЫЕ СТРУКТУРЫ ------------------
// Для мэчинга "на лету"
// Храним только во время работы сервера

let waitingUsers = []; // [{ socketId, ip }, ...]
const userPairs = {}; // { socketId: partnerSocketId }

// ------------------ ЛОГИКА SOCKET.IO ------------------

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Сохраняем запись в users (без профиля, пока только socket_id)
  db.run(
    `INSERT INTO users (socket_id, connected_at) VALUES (?, ?)`,
    [socket.id, Date.now()],
    (err) => {
      if (err) console.error('Ошибка INSERT в users:', err);
    }
  );

  // Когда пользователь задаёт профиль
  socket.on('setProfile', (profile) => {
    const { nickname, gender, age } = profile;

    // Обновляем запись в таблице users
    db.run(
      `UPDATE users SET nickname=?, gender=?, age=? WHERE socket_id=?`,
      [nickname, gender, age, socket.id],
      (err) => {
        if (err) console.error('Ошибка UPDATE профиля в users:', err);
      }
    );

    // Ставим в очередь или ищем пару
    matchOrWait(socket);
  });

  // Когда пользователь отправляет сообщение
  socket.on('sendMessage', (message) => {
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      // Логируем сообщение в chat_logs
      db.run(
        `INSERT INTO chat_logs (from_socket, to_socket, message, timestamp)
         VALUES (?, ?, ?, ?)`,
        [socket.id, partnerId, message, Date.now()],
        (err) => {
          if (err) console.error('Ошибка INSERT в chat_logs:', err);
        }
      );

      // Отправляем собеседнику
      io.to(partnerId).emit('receiveMessage', { text: message });
    }
  });

  // Кнопка «Следующий»
  socket.on('skip', () => {
    endChat(socket.id);
    matchOrWait(socket);
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Удалить из очереди
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);

    // Разорвать чат, если был
    endChat(socket.id);

    // Удаляем запись из users (чтобы хранились только активные)
    db.run(
      `DELETE FROM users WHERE socket_id=?`,
      [socket.id],
      (err) => {
        if (err) console.error('Ошибка DELETE из users:', err);
      }
    );
  });
});

// ------------------ ФУНКЦИИ ------------------

// Функция ставит сокет в очередь или находит пару
function matchOrWait(socket) {
  const socketId = socket.id;
  const ip = socket.handshake.address; // IP пользователя

  // Ищем в очереди пользователя с другим ip (чтобы не разговаривать с самим собой)
  let foundIndex = -1;
  for (let i = 0; i < waitingUsers.length; i++) {
    const w = waitingUsers[i];
    if (w.ip !== ip) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1) {
    // Не нашли подходящего
    waitingUsers.push({ socketId, ip });
    console.log(`Socket ${socketId} is now waiting`);
  } else {
    // Нашли
    const partner = waitingUsers[foundIndex];
    waitingUsers.splice(foundIndex, 1); // удаляем из очереди

    userPairs[socketId] = partner.socketId;
    userPairs[partner.socketId] = socketId;

    // Получим профиль из БД для сокета и партнёра
    db.get(
      `SELECT nickname, gender, age FROM users WHERE socket_id=?`,
      [socketId],
      (err, myProfile) => {
        db.get(
          `SELECT nickname, gender, age FROM users WHERE socket_id=?`,
          [partner.socketId],
          (err2, partnerProfile) => {

            io.to(socketId).emit('chatReady', {
              partnerId: partner.socketId,
              partnerProfile
            });

            io.to(partner.socketId).emit('chatReady', {
              partnerId: socketId,
              partnerProfile: myProfile
            });

            console.log(`Socket ${socketId} matched with ${partner.socketId}`);
          }
        );
      }
    );
  }
}

// Разрыв чата
function endChat(userId) {
  const partnerId = userPairs[userId];
  if (partnerId) {
    io.to(partnerId).emit('partnerLeft');
    delete userPairs[partnerId];
    delete userPairs[userId];
    console.log(`Chat ended between ${userId} and ${partnerId}`);
  }
}

// ------------------ СТАРТ СЕРВЕРА ------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
