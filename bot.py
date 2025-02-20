const TelegramBot = require('node-telegram-bot-api');

// Твой токен прямо в коде
const token = '8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA';

// URL WebApp (замени на свой)
const WEBAPP_URL = 'https://anonchat-production-5964.up.railway.app/';

// Создаём бота в режиме polling
const bot = new TelegramBot(token, { polling: true });

console.log("✅ Бот успешно запущен!");

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  try {
    const chatId = msg.chat.id;

    const welcomeText = `
Привет! Добро пожаловать в *Анонимный Чат*.

Нажмите на кнопку ниже, чтобы открыть наше мини-приложение и найти собеседника.
    `;

    await bot.sendMessage(chatId, welcomeText, {
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

    console.log(`🚀 Приветственное сообщение отправлено пользователю ${chatId}`);
  } catch (error) {
    console.error("❌ Ошибка при обработке команды /start:", error);
  }
});

// Обработка любых других сообщений
bot.on('message', async (msg) => {
  try {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Игнорируем повторную обработку /start
    if (text.startsWith('/start')) return;

    await bot.sendMessage(chatId, 'Напишите /start, чтобы открыть чат 😉');
  } catch (error) {
    console.error("❌ Ошибка при обработке сообщения:", error);
  }
});
