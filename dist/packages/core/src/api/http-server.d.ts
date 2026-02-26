export interface HttpServerHandle {
    close: () => Promise<void>;
}
export declare const startHttpServer: () => Promise<HttpServerHandle>;
//# sourceMappingURL=http-server.d.ts.map