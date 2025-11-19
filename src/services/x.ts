import { Client, OAuth1, OAuth1Config } from '@xdevplatform/xdk';
import * as common from '../common';
import { config } from '../config';
import axios from 'axios';

export interface IPostInfo {
    id: string;
    text?: string;
    retweets: number;
    replies: number;
    likes: number;
    quotes: number;
    bookmarks: number;
    views: number;
    media: {
        photoUrls: string[];
        videoUrls: string[];
    } | null;
}

const postURLPattern = /^https?:\/\/(www\.)?x\.com\/([a-zA-Z0-9_]{1,15})\/status\/(\d+)$/;

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

    validatePostURL(postURL: string): boolean {
        return postURLPattern.test(postURL);
    }

    extractPostID(postURL: string): string | null {
        const match = postURL.match(postURLPattern);
        return match ? match[3] : null;
    }

    private getPostMediaURLs(postData: any): { photoUrls: string[]; videoUrls: string[] } | null {
        const photoUrls: string[] = [];
        const videoUrls: string[] = [];

        if (!postData.media || typeof postData.media !== 'object') {
            return { photoUrls, videoUrls };
        }

        const media = postData.media;

        if (media.photo && Array.isArray(media.photo)) {
            for (const photo of media.photo) {
                if (photo.media_url_https) {
                    photoUrls.push(photo.media_url_https);
                }
            }
        }

        if (media.video && Array.isArray(media.video)) {
            for (const video of media.video) {
                if (video.variants && Array.isArray(video.variants)) {
                    const sortedVariants = video.variants
                        .filter((variant: any) => variant.bitrate)
                        .sort((a: any, b: any) => b.bitrate - a.bitrate);
                    if (sortedVariants.length > 0 && sortedVariants[0].url) {
                        videoUrls.push(sortedVariants[0].url);
                    }
                }
            }
        }

        if (photoUrls.length === 0 && videoUrls.length === 0) return null;
        return { photoUrls, videoUrls };
    }

    async getPostInfo(postURL: string): Promise<IPostInfo | null> {
        try {
            const postID = this.extractPostID(postURL);
            if (!postID) throw new Error('Invalid post URL, could not extract post ID');

            const options = {
                method: 'GET',
                url: `${config.x.RapidApiURL}/tweet.php`,
                params: {
                    id: postID
                },
                headers: config.x.RapidApiHeaders
            };
            const response = await axios.request(options);
            if (!response.data) throw new Error('No data in getPostMetrics response');
            const data = response.data;
            const media = this.getPostMediaURLs(data);

            return {
                retweets: data.retweets || 0,
                replies: data.replies || 0,
                likes: data.likes || 0,
                quotes: data.quotes || 0,
                bookmarks: data.bookmarks || 0,
                views: parseInt(data.views || '0'),
                media,
                id: postID,
                text: data.text
            };
        } catch (error) {
            common.logError(`XService.getPostMetrics: ${postURL} - ${error}`);
        }
        return null;
    }

    async getUserPosts(
        username: string,
        opts?: { includeReplies: boolean; includeReposts: boolean }
    ): Promise<IPostInfo[]> {
        try {
            const options = {
                method: 'GET',
                url: `${config.x.RapidApiURL}/timeline.php`,
                params: {
                    screenname: username
                },
                headers: config.x.RapidApiHeaders
            };
            const response = await axios.request(options);
            if (!response.data) throw new Error('No data in getPostMetrics response');
            if (!response.data.timeline || !Array.isArray(response.data.timeline))
                throw new Error('Invalid timeline data');
            const timeline = response.data.timeline as any[];

            const posts: IPostInfo[] = [];
            for (const tweet of timeline) {
                if (!opts?.includeReplies && tweet.reply_to) continue;
                if (!opts?.includeReposts && tweet.retweeted) continue;

                const media = this.getPostMediaURLs(tweet);
                posts.push({
                    id: tweet.tweet_id,
                    text: tweet.text,
                    retweets: tweet.retweets || 0,
                    replies: tweet.replies || 0,
                    likes: tweet.likes || 0,
                    quotes: tweet.quotes || 0,
                    bookmarks: tweet.bookmarks || 0,
                    views: parseInt(tweet.views || '0'),
                    media
                });
            }
            return posts;
        } catch (error) {
            common.logError(`XService.getUserPosts: ${username} - ${error}`);
        }
        return [];
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
