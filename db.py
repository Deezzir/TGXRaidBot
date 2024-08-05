import logging
import asyncio
import abc
import os
import sys
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.server_api import ServerApi

load_dotenv()
LOGGER: logging.Logger = logging.getLogger(__name__)


class Database(metaclass=abc.ABCMeta):
    @classmethod
    def __subclasshook__(cls, subclass):
        return (
            hasattr(subclass, "initialize")
            and callable(subclass.get)
            and hasattr(subclass, "check")
            and callable(subclass.set)
            or NotImplemented
        )

    @abc.abstractmethod
    def initialize(self) -> None:
        """Initialize the database."""
        raise NotImplementedError

    async def check(self) -> None:
        """Check the database."""
        raise NotImplementedError


class MongoDB(Database):
    def __init__(self) -> None:
        self.MONGO_URI = os.getenv("MONGO_URI", "")
        self.COLLECTION_NAME = os.getenv("COLLECTION_NAME", "raid")
        self.client = None
        self.db = None
        self.CHAT_COLLECTION = None

    def initialize(self):
        LOGGER.info("Initializing MongoDB")
        self.client = AsyncIOMotorClient(self.MONGO_URI, server_api=ServerApi("1"))
        self.db = self.client[self.COLLECTION_NAME]
        self.BANNED_COLLECTION = self.db["chats"]

    async def check(self):
        LOGGER.info("Checking MongoDB")
        try:
            await self.client.admin.command("ping")
            LOGGER.info(
                "Pinged your deployment. You successfully connected to MongoDB!"
            )
        except Exception as e:
            LOGGER.error(e)
            sys.exit(1)


async def main():
    db = MongoDB()
    await db.initialize()
    await db.check()


if __name__ == "__main__":
    asyncio.run(main())
