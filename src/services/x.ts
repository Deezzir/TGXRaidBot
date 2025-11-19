import { Client, OAuth1, OAuth1Config } from '@xdevplatform/xdk';
import * as common from '../common';
import { config } from '../config';
import axios from 'axios';

interface PostMetrics {
    retweets: number;
    replies: number;
    likes: number;
    quotes: number;
    bookmarks: number;
    views: number;
}

class XService {
    private client: Client;

    constructor() {
        const oauthConfig: OAuth1Config = {
            apiKey: config.x.APIKey,
            apiSecret: config.x.APISecretKey,
            accessToken: config.x.AccessToken,
            accessTokenSecret: config.x.AccessTokenSecret,
            callback: ''
        };
        const oauth1: OAuth1 = new OAuth1(oauthConfig);
        this.client = new Client({ oauth1: oauth1 });
    }

    async getPostMetrics(postID: string): Promise<PostMetrics> {
        try {
            const options = {
                method: 'GET',
                url: `${config.x.RapidApiURL}/tweet.php`,
                params: {
                    id: postID
                },
                headers: config.x.RapidApiHeaders
            };
            const response = await axios.request(options);
            if (!response.data) throw new Error('No data or public_metrics in getPostMetrics response');

            return {
                retweets: response.data.retweets || 0,
                replies: response.data.replies || 0,
                likes: response.data.likes || 0,
                quotes: response.data.quotes || 0,
                bookmarks: response.data.bookmarks || 0,
                views: parseInt(response.data.views || '0')
            };
        } catch (error) {
            common.logError(`XService.getPostMetrics: ${postID} - ${error}`);
            throw new Error(`XService.getPostMetrics failed: ${error}`);
        }
    }

    async createPost(text: string, mediaIDs: string[] = []): Promise<string> {
        try {
            const response = await this.client.posts.create({
                text: text,
                media: mediaIDs.length > 0 ? { media_ids: mediaIDs } : undefined
            });
            if (!response.data || !response.data.id) throw new Error('No data or ID in makePost response');
            return response.data.id;
        } catch (error) {
            common.logError(`XService.makePost: ${error}`);
            throw new Error(`XService.makePost failed: ${error}`);
        }
    }

    async createReply(text: string, inReplyToPostID: string): Promise<string> {
        try {
            const response = await this.client.posts.create({
                text: text,
                reply: {
                    in_reply_to_tweet_id: inReplyToPostID
                }
            });
            if (!response.data || !response.data.id) throw new Error('No data or ID in makeReply response');
            return response.data.id;
        } catch (error) {
            common.logError(`XService.makeReply: ${error}`);
            throw new Error(`XService.makeReply failed: ${error}`);
        }
    }

    async uploadMedia(image: Buffer, type: 'image/png' | 'image/gif' | 'image/jpeg'): Promise<string> {
        try {
            const initResp = await this.client.media.initializeUpload({
                body: {
                    // @ts-ignore
                    media_type: type,
                    media_category: 'tweet_image',
                    total_bytes: image.length
                }
            });
            if (!initResp.data) throw new Error('No data in initialize upload response');
            const mediaID = initResp.data.id;

            await this.client.media.appendUpload(mediaID, {
                body: {
                    segment_index: 0,
                    media: image.toString('base64')
                }
            });
            const finResp = await this.client.media.finalizeUpload(mediaID);
            if (!finResp.data) throw new Error('No data in finalize upload response');

            if (finResp.data.processing_info && finResp.data.processing_info.state !== 'succeeded') {
                try {
                    await this.pollMediaUpload(mediaID);
                } catch (pollError) {
                    common.logError(`XService.uploadMedia polling error: ${pollError}`);
                    throw new Error(`XService.uploadMedia polling failed: ${pollError}`);
                }
            }
            return mediaID;
        } catch (error) {
            common.logError(`XService.uploadMedia: ${error}`);
            throw new Error(`XService.uploadMedia failed: ${error}`);
        }
    }

    private async pollMediaUpload(mediaID: string, attempts: number = 10): Promise<void> {
        try {
            let status = 'in_progress';

            while ((status === 'in_progress' || status === 'pending') && attempts > 0) {
                const resp = await this.client.media.getUploadStatus(mediaID, { command: 'STATUS' });
                if (resp.data) {
                    status = resp.data.processing_info.state || 'succeeded';
                }
                attempts--;
                await common.sleep(500);
            }

            if (status !== 'succeeded') throw new Error(`Media upload failed or timed out for mediaID: ${mediaID}`);
        } catch (error) {
            common.logError(`XService.pollMediaUpload: ${error}`);
            throw new Error(`XService.pollMediaUpload failed: ${error}`);
        }
    }
}

export default new XService();
