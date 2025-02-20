const TelegramBot = require('node-telegram-bot-api');

// Замените '8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA' на токен вашего бота, полученный от @BotFather
const token = '8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA';

// URL вашего WebApp — обязательно с https://
const WEBAPP_URL = 'https://anonchat-production-5964.up.railway.app/';

// Создаём бота в режиме polling
const bot = new TelegramBot(token, { polling: true });

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const welcomeText = `
Привет! Добро пожаловать в *Анонимный Чат*.

Нажмите на кнопку ниже, чтобы открыть наше мини-приложение и найти собеседника.
  `;

  bot.sendMessage(chatId, welcomeText, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Открыть чат',
            web_app: {
              url: WEBAPP_URL
            }
          }
        ]
      ]
    }
  }).then((data) => {
    console.log("Приветственное сообщение отправлено:", data);
  }).catch((err) => {
    console.error("Ошибка отправки приветственного сообщения:", err);
  });
});

// Обработка любых других сообщений
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/start')) {
    bot.sendMessage(msg.chat.id, 'Напишите /start, чтобы открыть чат 😉');
  }
});
