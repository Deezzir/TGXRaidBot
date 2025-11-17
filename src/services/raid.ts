import DBService from './db';
import * as common from '../common';

interface RaidState {
    active: boolean;
    currentPostID?: string;
    process: Promise<void> | null;
}

export default class RaidService {
    private state: RaidState;

    constructor(active: boolean = false, currentPostID?: string) {
        this.state = {
            active: active,
            currentPostID: currentPostID,
            process: this.raidLoop()
        };
    }

    static async initialize(): Promise<RaidService> {
        const currentRaid = await DBService.getActiveRaid();
        if (currentRaid) {
            common.logInfo(`Resuming active raid on post ID: ${currentRaid.postID}`);
            return new RaidService(true, currentRaid.postID);
        }
        return new RaidService();
    }

    async startRaid() {
        await this.state.process;
    }

    async cancelRaid() {
        this.state.active = false;
        this.state.currentPostID = undefined;
        this.state.process = null;
        common.logInfo('Raid cancelled.');
    }

    private async raidLoop() {
        this.state.active = true;
        common.logInfo('Raid started.');

        while (this.state.active) {}

        common.logInfo('Raid loop exited.');
    }
}
