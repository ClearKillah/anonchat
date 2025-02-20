const TelegramBot = require('node-telegram-bot-api');

// Используйте переменную окружения или ваш токен
const token = process.env.BOT_TOKEN || '8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA';

// Создаём бота в режиме polling
const bot = new TelegramBot(token, { polling: true });

// URL вашего WebApp — обязательно с https://
const WEBAPP_URL = 'https://anonchat-production-5964.up.railway.app';

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
  });
});

// Для теста: если сообщение не /start, посылаем инструкцию
bot.on('message', (msg) => {
  if (msg.text && !/^\/start/.test(msg.text)) {
    bot.sendMessage(msg.chat.id, 'Напишите /start, чтобы открыть чат 😉');
  }
});
