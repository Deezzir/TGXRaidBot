import mongoose, { Schema, Document } from 'mongoose';
import * as common from '../common';
import { config, Environment } from '../config';

export enum RaidStateEnum {
    Active = 'active',
    Completed = 'completed',
    Cancelled = 'cancelled',
    Expired = 'expired'
}

export interface IMetrics {
    likes: number;
    retweets: number;
    replies: number;
    bookmarks: number;
}

export interface IRaid extends Document {
    targetMetrics: IMetrics;
    index: number;
    postImageSource?: string;
    startedAt: Date;
    state: RaidStateEnum;
    postURL?: string;
    endedAt?: Date;
    buyBackTX: string | null;
    addLiqTX: string | null;
}

const CounterSchema = new Schema({
    name: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
});

const CounterModel = mongoose.model('Counter', CounterSchema);

const RaidSchema: Schema = new Schema(
    {
        targetMetrics: {
            likes: { type: Number, required: true },
            retweets: { type: Number, required: true },
            replies: { type: Number, required: true },
            bookmarks: { type: Number, required: true }
        },
        state: { type: String, enum: Object.values(RaidStateEnum), required: true, default: RaidStateEnum.Active },
        index: { type: Number, required: true },
        postURL: { type: String, required: false },
        postImageSource: { type: String, required: false },
        startedAt: { type: Date, required: true, default: Date.now },
        endedAt: { type: Date, required: false },
        buyBackTX: { type: String, required: false },
        addLiqTX: { type: String, required: false }
    },
    { timestamps: true }
);

RaidSchema.pre('validate', async function (next) {
    if (!this.isNew) return next();

    const counter = await CounterModel.findOneAndUpdate(
        { name: 'raid_index' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );

    this.index = counter.seq;
    next();
});

const RaidModel = mongoose.model<IRaid>('Raid', RaidSchema);

class DBService {
    async getNextRaidIndex(): Promise<number> {
        try {
            const counter = await CounterModel.findOne({ name: 'raid_index' });
            return counter ? counter.seq + 1 : 1;
        } catch (error) {
            common.logError(`DBService.getNextRaidIndex: ${error}`);
            throw new Error(`DBService.getNextRaidIndex failed: ${error}`);
        }
    }

    async getRaids(): Promise<IRaid[]> {
        try {
            const raids = await RaidModel.find().lean().exec();
            return raids as unknown as IRaid[];
        } catch (error) {
            common.logError(`DBService.getRaids: ${error}`);
            throw new Error(`DBService.getRaids failed: ${error}`);
        }
    }

    async createRaid(raidData: Partial<IRaid>): Promise<IRaid> {
        try {
            const raid = new RaidModel(raidData);
            await raid.save();
            return raid;
        } catch (error) {
            common.logError(`DBService.createRaid: ${error}`);
            throw new Error(`DBService.createRaid failed: ${error}`);
        }
    }

    async getActiveRaid(): Promise<IRaid | null> {
        try {
            const raid = await RaidModel.findOne({ state: RaidStateEnum.Active }).lean().exec();
            return raid as unknown as IRaid | null;
        } catch (error) {
            common.logError(`DBService.getActiveRaid: ${error}`);
            throw new Error(`DBService.getActiveRaid failed: ${error}`);
        }
    }

    async getLatestRaid(): Promise<IRaid | null> {
        try {
            const raid = await RaidModel.findOne().sort({ createdAt: -1 }).lean().exec();
            return raid as unknown as IRaid | null;
        } catch (error) {
            common.logError(`DBService.getLatestRaid: ${error}`);
            throw new Error(`DBService.getLatestRaid failed: ${error}`);
        }
    }

    async updateRaid(raidID: string, updateData: Partial<IRaid>): Promise<IRaid | null> {
        try {
            const raid = await RaidModel.findByIdAndUpdate(raidID, updateData, { new: true }).exec();
            return raid as unknown as IRaid | null;
        } catch (error) {
            common.logError(`DBService.updateRaid: ${error}`);
            throw new Error(`DBService.updateRaid failed: ${error}`);
        }
    }

    async getUsedPostImageFiles(): Promise<string[]> {
        try {
            const raids = await RaidModel.find({ state: RaidStateEnum.Completed })
                .select('postImageSource')
                .lean()
                .exec();

            return raids.map((raid) => raid.postImageSource).filter((source): source is string => Boolean(source));
        } catch (error) {
            common.logError(`DBService.getUsedPostImageFiles: ${error}`);
            throw new Error(`DBService.getUsedPostImageFiles failed: ${error}`);
        }
    }
}

function getDBName() {
    return config.env === Environment.Development ? config.db.dbName + '-dev' : config.db.dbName;
}

export async function connectDB() {
    try {
        await mongoose.connect(config.db.mongodbURI, {
            dbName: getDBName(),
            autoIndex: config.env !== Environment.Production
        });

        common.logInfo(`MongoDB Connected: ${mongoose.connection.host}:${mongoose.connection.port}`);
    } catch (error) {
        common.logError(`MongoDB connection error: ${error}`);
        process.exit(1);
    }
}

export async function pingDB(): Promise<boolean> {
    try {
        if (mongoose.connection.readyState !== 1) {
            common.logError('MongoDB is not connected');
            return false;
        }
        if (!mongoose.connection.db) {
            common.logError('MongoDB database is not available');
            return false;
        }
        await mongoose.connection.db.admin().ping();
        common.logInfo('MongoDB ping successful');
        return true;
    } catch (error) {
        common.logError(`MongoDB ping failed: ${error}`);
        return false;
    }
}

export async function closeDB() {
    try {
        await mongoose.connection.close();
        common.logInfo('MongoDB connection closed');
    } catch (error) {
        common.logError(`Error closing MongoDB connection: ${error}`);
    }
}

export default new DBService();
