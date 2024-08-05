import asyncio
import os
from aiogram import Dispatcher, Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.types import Message
from dotenv import load_dotenv

load_dotenv()

# Environment variables
TOKEN: str = os.getenv("BOT_TOKEN", "")

DISPATCHER: Dispatcher = Dispatcher()
BOT: Bot = Bot(token=TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))


@DISPATCHER.message(CommandStart())
async def command_start_handler(message: Message) -> None:
    payload = (
        f"⚙️ Commands to start the raid:\n\n"
        f"*Simple:*\n"
        f"/raid;\n\n"
        f"*With post link, ex:*\n"
        f"/raid https://x.com/username/status/12345678900987654321;\n\n"
        f"*With new (not total) likes, retweets, replies and bookmarks, ex:\n*"
        f"/raid 4 3 5 2;\n\n"
        f"*With post link and new (not total) likes, retweets, replies and bookmarks, ex:*\n"
        f"/raid https://x.com/username/status/12345678900987654321 4 3 5 2;\n\n"
        f"*Check current group power-points balance (WIP):*\n"
        f"/points;\n\n"
        f"*Cancel all raids and actions:*\n"
        f"/cancel;\n\n"
    )
    await message.answer(text=payload, parse_mode=ParseMode.MARKDOWN)


@DISPATCHER.message()
async def echo_handler(message: Message) -> None:
    try:
        await message.send_copy(chat_id=message.chat.id)
    except TypeError:
        await message.answer("I can't send this message")


async def main() -> None:
    await DISPATCHER.start_polling(BOT)


asyncio.run(main())
