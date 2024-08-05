import asyncio
import os
from aiogram import Dispatcher, Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart, Command, CommandObject
from aiogram.types import Message, InlineKeyboardButton, InlineKeyboardMarkup
from dotenv import load_dotenv
import logging
import sys
from typing import Dict

load_dotenv()

# Environment variables
TOKEN: str = os.getenv("BOT_TOKEN", "")
NAME: str = "uranusraidsbot"
TITLE: str = "🔰 Uranus Raid Bot V1.0"
DESCRIPTION: str = "The ultimate bot for Twitter raids on Telegram."
COMMANDS: Dict[str, str] = {
    "raid": "Start new raid",
    "config": "Show config menu",
    "cancel": "Cancel all current raids and actions",
    "points": "Get current power-points",
}

DISPATCHER: Dispatcher = Dispatcher()
BOT: Bot = Bot(token=TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))

TUTORIAL_PAYLOAD: str = (
    f"⚙️ Commands to work with a raid:\n\n"
    f"*Config:*\n"
    f"/config\n\n"
    f"*Simple:*\n"
    f"/raid\n\n"
    f"*With post link, ex:*\n"
    f"/raid https://x.com/username/status/12345678900987654321\n\n"
    f"*With new (not total) likes, retweets, replies and bookmarks, ex:\n*"
    f"/raid 4 3 5 2;\n\n"
    f"*With post link and new (not total) likes, retweets, replies and bookmarks, ex:*\n"
    f"/raid https://x.com/username/status/12345678900987654321 4 3 5 2\n\n"
    f"*Check current group power-points balance (WIP):*\n"
    f"/points\n\n"
    f"*Cancel all raids and actions:*\n"
    f"/cancel\n\n"
)


@DISPATCHER.message(CommandStart())
async def command_start_handler(message: Message) -> None:
    """
    This handler receives messages with `/start` command
    """
    if message.from_user is not None:
        inline_button = InlineKeyboardButton(
            text="Set me as admin",
            url=f"https://t.me/{NAME}?startgroup=start&amp;admin=can_invite_users",
            callback_data="add_admin",
        )
        inline_keyboard = InlineKeyboardMarkup(inline_keyboard=[[inline_button]])
        commands_string = "\n".join(
            [f"/{command} - {description}" for command, description in COMMANDS.items()]
        )
        payload = (
            f"{TITLE}\n\n" f"{DESCRIPTION}\n\n" f"Commands:\n" f"{commands_string}\n\n"
        )
        await message.answer(payload, reply_markup=inline_keyboard)
    else:
        await message.answer(text=TUTORIAL_PAYLOAD, parse_mode=ParseMode.MARKDOWN)


@DISPATCHER.message(Command("config"))
async def command_config_handler(message: Message) -> None:
    tutorial_button = InlineKeyboardButton(
        text="❔ Tutorial Message", callback_data="handle_get_tutorial"
    )
    lock_chat_button = InlineKeyboardButton(
        text="🔒 Lock Chat", callback_data="handle_lock_chat"
    )
    gif_color_button = InlineKeyboardButton(
        text="🌿 Gif Color", callback_data="handle_gif_color"
    )
    progress_bar_color_button = InlineKeyboardButton(
        text="🌿 Progress Bar Color", callback_data="handle_progress_bar_color"
    )
    close_button = InlineKeyboardButton(text="🔴 Close", callback_data="handle_close")
    inline_keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [tutorial_button],
            [lock_chat_button],
            [gif_color_button, progress_bar_color_button],
            [close_button],
        ]
    )
    payload = f"ℹ️ UranusRaidBot is one of the most innovative raid bots on Telegram."
    await message.answer(text=payload, reply_markup=inline_keyboard)


@DISPATCHER.message(Command("raid"))
async def command_raid_handler(message: Message, command: CommandObject) -> None:
    pass


@DISPATCHER.message(Command("points"))
async def command_points_handler(message: Message) -> None:
    await message.answer(text="WIP")


@DISPATCHER.message(Command("cancel"))
async def command_cancel_handler(message: Message) -> None:
    await message.answer(text="WIP")


async def main() -> None:
    await DISPATCHER.start_polling(BOT)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stdout,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    asyncio.run(main())
