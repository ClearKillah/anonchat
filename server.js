const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// ------------------ ИНИЦИАЛИЗАЦИЯ EXPRESS/IO ------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Подключаем статические файлы (index.html и т.д.)
app.use(express.static(path.join(__dirname, 'public')));

// Для проверки (GET /ping)
app.get('/ping', (req, res) => {
  res.send('Server is running!');
});

// ------------------ ПОДКЛЮЧЕНИЕ К БД ------------------
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

// ------------------ ДАННЫЕ В ПАМЯТИ ------------------
// Эти структуры живут только во время работы сервера, для моментального мэчинга

// Очередь ожидания
let waitingUsers = []; // [{ socketId, ip }, ...]

// Пары { socketId: partnerSocketId }
const userPairs = {};

// ------------------ СОКЕТ-ЛОГИКА ------------------

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // При подключении мы можем сохранить user (пока без профиля) в БД:
  db.run(
    `INSERT INTO users (socket_id, connected_at) VALUES (?, ?)`,
    [socket.id, Date.now()],
    (err) => {
      if (err) console.error('Ошибка записи в users:', err);
    }
  );

  // 1. Когда пользователь отправляет профиль
  socket.on('setProfile', (profile) => {
    const { nickname, gender, age } = profile;

    // Обновим данные в таблице users
    db.run(
      `UPDATE users SET nickname=?, gender=?, age=? WHERE socket_id=?`,
      [nickname, gender, age, socket.id],
      (err) => {
        if (err) console.error('Ошибка при UPDATE пользователя:', err);
      }
    );

    // Попробуем найти пару
    matchOrWait(socket);
  });

  // 2. Когда пользователь отправляет сообщение
  socket.on('sendMessage', (message) => {
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      // Запишем в таблицу chat_logs
      db.run(
        `INSERT INTO chat_logs (from_socket, to_socket, message, timestamp)
         VALUES (?, ?, ?, ?)`,
        [socket.id, partnerId, message, Date.now()],
        (err) => {
          if (err) console.error('Ошибка INSERT в chat_logs:', err);
        }
      );

      // Отправим собеседнику
      io.to(partnerId).emit('receiveMessage', { text: message });
    }
  });

  // 3. Кнопка "Следующий"
  socket.on('skip', () => {
    endChat(socket.id);
    matchOrWait(socket); // снова ищем пару
  });

  // 4. Отключение
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Удалить из очереди
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);

    // Завершим чат (если был)
    endChat(socket.id);

    // Удалим пользователя из таблицы users (если хотим хранить только "онлайн")
    db.run(
      `DELETE FROM users WHERE socket_id=?`,
      [socket.id],
      (err) => {
        if (err) console.error('Ошибка при DELETE пользователя:', err);
      }
    );
  });
});

// ------------------ ФУНКЦИИ ------------------

// 1) matchOrWait: ставим в очередь или мэчим
function matchOrWait(socket) {
  const socketId = socket.id;
  const ip = socket.handshake.address;

  // Ищем в очереди человека с другим ip, например (чтобы не мэчить себя)
  let foundIndex = -1;
  for (let i = 0; i < waitingUsers.length; i++) {
    const w = waitingUsers[i];
    if (w.ip !== ip) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1) {
    // Никого подходящего не нашли
    waitingUsers.push({ socketId, ip });
    console.log(`Socket ${socketId} is now waiting`);
  } else {
    // Нашли
    const partner = waitingUsers[foundIndex];
    waitingUsers.splice(foundIndex, 1);

    userPairs[socketId] = partner.socketId;
    userPairs[partner.socketId] = socketId;

    // Получим профиль из БД, чтобы отправить инфу собеседнику
    db.get(`SELECT nickname, gender, age FROM users WHERE socket_id=?`, [socketId], (err, myProfile) => {
      db.get(`SELECT nickname, gender, age FROM users WHERE socket_id=?`, [partner.socketId], (err2, partnerProfile) => {
        io.to(socketId).emit('chatReady', {
          partnerId: partner.socketId,
          partnerProfile
        });
        io.to(partner.socketId).emit('chatReady', {
          partnerId: socketId,
          partnerProfile: myProfile
        });
        console.log(`Socket ${socketId} matched with ${partner.socketId}`);
      });
    });
  }
}

// 2) endChat: разрываем пару
function endChat(userId) {
  const partnerId = userPairs[userId];
  if (partnerId) {
    // Сообщим партнёру
    io.to(partnerId).emit('partnerLeft');
    // Удалим связь
    delete userPairs[partnerId];
    delete userPairs[userId];
    console.log(`Chat ended between ${userId} and ${partnerId}`);
  }
}

// ------------------ ЗАПУСК СЕРВЕРА ------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
