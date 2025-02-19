const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const fs = require('fs');

// -- ИНИЦИАЛИЗАЦИЯ EXPRESS/IO --

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаём статику из public
app.use(express.static(path.join(__dirname, 'public')));

// Настройка отдачи загруженных файлов (папка uploads):
// чтобы файл по адресу /uploads/filename был доступен
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// -- ПОДКЛЮЧЕНИЕ К SQLite --

const db = new sqlite3.Database('./chat.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к SQLite:', err);
  } else {
    console.log('Connected to SQLite database.');
  }
});

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

// -- МЕХАНИЗМ ОЧЕРЕДИ --

let waitingUsers = []; // [{ socketId, ip }, ...]
const userPairs = {}; // { socketId: partnerSocketId }

// -- МАРШРУТ /ping (проверка) --
app.get('/ping', (req, res) => {
  res.send('Server is running!');
});

// -- НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ФАЙЛОВ --

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads'); // кладём в папку uploads
  },
  filename: function (req, file, cb) {
    // указываем уникальное имя файла, например, Date.now + оригинальное имя
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// -- МАРШРУТ ДЛЯ ПРИЁМА ФАЙЛОВ --

app.post('/upload', upload.single('file'), (req, res) => {
  // файл сохранён в req.file
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Возвращаем клиенту путь к файлу
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});

// -- ЛОГИКА SOCKET.IO --

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Сохраняем в БД юзера (без профиля)
  db.run(
    `INSERT INTO users (socket_id, connected_at) VALUES (?, ?)`,
    [socket.id, Date.now()],
    (err) => {
      if (err) console.error('Ошибка INSERT в users:', err);
    }
  );

  // Получаем профиль
  socket.on('setProfile', (profile) => {
    const { nickname, gender, age } = profile;

    // Обновляем запись в БД
    db.run(
      `UPDATE users SET nickname=?, gender=?, age=? WHERE socket_id=?`,
      [nickname, gender, age, socket.id],
      (err) => {
        if (err) console.error('Ошибка UPDATE профиля:', err);
      }
    );

    matchOrWait(socket);
  });

  // Текстовые сообщения
  socket.on('sendMessage', (message) => {
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      // Пишем в БД
      db.run(
        `INSERT INTO chat_logs (from_socket, to_socket, message, timestamp)
         VALUES (?, ?, ?, ?)`,
        [socket.id, partnerId, message, Date.now()],
        (err) => {
          if (err) console.error('Ошибка INSERT chat_logs:', err);
        }
      );

      // Отправляем партнёру
      io.to(partnerId).emit('receiveMessage', { text: message });
    }
  });

  // Медиа-сообщения (клиент сначала загружает на /upload, потом шлёт сюда event)
  socket.on('sendMedia', (fileUrl) => {
    const partnerId = userPairs[socket.id];
    if (partnerId) {
      // Можно логировать отдельно, или в ту же таблицу
      const msg = '[MEDIA] ' + fileUrl;
      db.run(
        `INSERT INTO chat_logs (from_socket, to_socket, message, timestamp)
         VALUES (?, ?, ?, ?)`,
        [socket.id, partnerId, msg, Date.now()],
        (err) => {
          if (err) console.error('Ошибка INSERT chat_logs (media):', err);
        }
      );
      // Отправим событие собеседнику
      io.to(partnerId).emit('receiveMedia', { fileUrl });
    }
  });

  // Следующий
  socket.on('skip', () => {
    endChat(socket.id);
    matchOrWait(socket);
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    waitingUsers = waitingUsers.filter(u => u.socketId !== socket.id);
    endChat(socket.id);

    db.run(`DELETE FROM users WHERE socket_id=?`, [socket.id], (err) => {
      if (err) console.error('Ошибка DELETE user:', err);
    });
  });
});

// Функция подбора пары
function matchOrWait(socket) {
  const socketId = socket.id;
  const ip = socket.handshake.address;

  let foundIndex = -1;
  for (let i = 0; i < waitingUsers.length; i++) {
    const w = waitingUsers[i];
    // условие "другой ip" (не сам себе)
    if (w.ip !== ip) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1) {
    // Добавим в очередь
    waitingUsers.push({ socketId, ip });
    console.log(`Socket ${socketId} is now waiting`);
  } else {
    // Мэчим
    const partner = waitingUsers[foundIndex];
    waitingUsers.splice(foundIndex, 1);

    userPairs[socketId] = partner.socketId;
    userPairs[partner.socketId] = socketId;

    // Получаем профили
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

function endChat(userId) {
  const partnerId = userPairs[userId];
  if (partnerId) {
    io.to(partnerId).emit('partnerLeft');
    delete userPairs[partnerId];
    delete userPairs[userId];
    console.log(`Chat ended between ${userId} and ${partnerId}`);
  }
}

// Запуск
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
