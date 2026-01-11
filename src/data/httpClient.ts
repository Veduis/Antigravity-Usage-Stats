import { logger } from '../services/logger';
import { AntigravityError, ErrorType } from '../services/errorHandler';

/**
 * HTTP client configuration.
 */
export interface HttpClientConfig {
    baseUrl?: string;
    timeout: number;
    headers: Record<string, string>;
}

/**
 * HTTP response wrapper.
 */
export interface HttpResponse<T = unknown> {
    data: T;
    status: number;
    headers: Headers;
}

/**
 * HTTP client for making API requests.
 */
export class HttpClient {
    private static instance: HttpClient;
    private config: HttpClientConfig = {
        timeout: 10000,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    private constructor() { }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): HttpClient {
        if (!HttpClient.instance) {
            HttpClient.instance = new HttpClient();
        }
        return HttpClient.instance;
    }

    /**
     * Configures the HTTP client.
     */
    public configure(config: Partial<HttpClientConfig>): void {
        this.config = { ...this.config, ...config };
        logger.debug('HttpClient configured', this.config);
    }

    /**
     * Sets the base URL for all requests.
     */
    public setBaseUrl(url: string): void {
        this.config.baseUrl = url;
    }

    /**
     * Sets an authorization header.
     */
    public setAuthToken(token: string): void {
        this.config.headers['Authorization'] = `Bearer ${token}`;
    }

    /**
     * Clears the authorization header.
     */
    public clearAuthToken(): void {
        delete this.config.headers['Authorization'];
    }

    /**
     * Makes a GET request.
     */
    public async get<T>(path: string, options?: RequestInit): Promise<HttpResponse<T>> {
        return this.request<T>('GET', path, undefined, options);
    }

    /**
     * Makes a POST request.
     */
    public async post<T>(
        path: string,
        body?: unknown,
        options?: RequestInit
    ): Promise<HttpResponse<T>> {
        return this.request<T>('POST', path, body, options);
    }

    /**
     * Makes a PUT request.
     */
    public async put<T>(
        path: string,
        body?: unknown,
        options?: RequestInit
    ): Promise<HttpResponse<T>> {
        return this.request<T>('PUT', path, body, options);
    }

    /**
     * Makes a DELETE request.
     */
    public async delete<T>(path: string, options?: RequestInit): Promise<HttpResponse<T>> {
        return this.request<T>('DELETE', path, undefined, options);
    }

    /**
     * Core request method.
     */
    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
        options?: RequestInit
    ): Promise<HttpResponse<T>> {
        const url = this.buildUrl(path);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            logger.debug(`${method} ${url}`);

            const response = await fetch(url, {
                method,
                headers: {
                    ...this.config.headers,
                    ...(options?.headers as Record<string, string>),
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
                ...options,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new AntigravityError(
                    `HTTP ${response.status}: ${response.statusText}`,
                    ErrorType.NETWORK,
                    true,
                    `Request failed: ${response.statusText}`
                );
            }

            const data = await response.json() as T;

            return {
                data,
                status: response.status,
                headers: response.headers,
            };
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof AntigravityError) {
                throw error;
            }

            if (error instanceof Error && error.name === 'AbortError') {
                throw new AntigravityError(
                    'Request timeout',
                    ErrorType.NETWORK,
                    true,
                    'Request timed out. Please try again.'
                );
            }

            throw new AntigravityError(
                error instanceof Error ? error.message : 'Network error',
                ErrorType.NETWORK,
                true,
                'Network error. Please check your connection.'
            );
        }
    }

    /**
     * Builds the full URL from path and base URL.
     */
    private buildUrl(path: string): string {
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }

        if (this.config.baseUrl) {
            const base = this.config.baseUrl.endsWith('/')
                ? this.config.baseUrl.slice(0, -1)
                : this.config.baseUrl;
            const cleanPath = path.startsWith('/') ? path : `/${path}`;
            return `${base}${cleanPath}`;
        }

        return path;
    }
}

// Export singleton
export const httpClient = HttpClient.getInstance();
