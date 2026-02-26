export interface HttpServerHandle {
  close: () => Promise<void>;
}

export const startHttpServer = async (): Promise<HttpServerHandle> => {
  return {
    async close() {
      return;
    },
  };
};
