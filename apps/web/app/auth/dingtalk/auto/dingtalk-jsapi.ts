export interface DingtalkJsapiModule {
  runtime?: {
    permission?: {
      requestAuthCode?: (options: {
        corpId: string;
        onSuccess?: (result: { code?: string }) => void;
        onFail?: (err: unknown) => void;
      }) => void;
    };
  };
  ready?: (fn: () => void) => void;
  default?: DingtalkJsapiModule;
}

export function requestAuthCode(mod: DingtalkJsapiModule, corpId: string): Promise<string> {
  const dd = mod.default ?? mod;
  const request = dd.runtime?.permission?.requestAuthCode;
  if (typeof request !== "function") {
    return Promise.reject(new Error("dingtalk-jsapi requestAuthCode unavailable"));
  }

  return new Promise((resolve, reject) => {
    const run = () => {
      request({
        corpId,
        onSuccess: (result) => {
          const code = typeof result?.code === "string" ? result.code.trim() : "";
          if (code) {
            resolve(code);
          } else {
            reject(new Error("empty auth code"));
          }
        },
        onFail: () => reject(new Error("requestAuthCode failed"))
      });
    };

    if (typeof dd.ready === "function") {
      dd.ready(run);
    } else {
      run();
    }
  });
}
