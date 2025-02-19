const TelegramBot = require('node-telegram-bot-api');

// Замените на ваш токен, выданный BotFather
const token = process.env.BOT_TOKEN || '8039344227:AAFuRzP92ZoGOxRC3EOWF-OXVIyjfFnh9NA';

// Создаём бота в режиме polling
const bot = new TelegramBot(token, { polling: true });

// Этот URL — ваш WebApp (анонимный чат), например, домен Railway
const WEBAPP_URL = 'anonchat-production-5964.up.railway.app'; 

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const welcomeText = `
*Анонимный Чат* — твой быстрый способ найти собеседника!

**Сильные стороны**:
• Полная анонимность — только выбранный ник, возраст и интересы  
• Мгновенный подбор партнёра для флирта, игр или простого общения  
• Удобно на любом устройстве  

Нажми на кнопку, чтобы открыть анонимный чат и начать общение прямо сейчас!  
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
