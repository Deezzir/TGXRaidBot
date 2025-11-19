import { readFileSync } from 'fs';

export function logInfo(msg: string) {
    console.log(`[INFO] ${msg}`);
}

export function logError(msg: string) {
    console.error(`[ERROR] ${msg}`);
}

export function logWarn(msg: string) {
    console.warn(`[WARN] ${msg}`);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry_with_backoff<T>(operation: () => Promise<T>, retries = 5, delay_ms = 100): Promise<T> {
    try {
        await sleep(delay_ms);
        return await operation();
    } catch (error: any) {
        if (retries === 0 || !error.toString().includes('429')) {
            throw error;
        }
        return retry_with_backoff(operation, retries - 1, delay_ms * 3);
    }
}

export function getImageBuffer(path: string): Buffer {
    try {
        return readFileSync(path);
    } catch (error) {
        logError(`getImageBuffer: Failed to read image at path ${path}: ${error}`);
        throw error;
    }
}
