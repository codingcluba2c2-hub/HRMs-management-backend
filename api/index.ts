let app: any;
let initError: any = null;

try {
  const serverModule = require('../src/server');
  app = serverModule.default || serverModule;
} catch (err: any) {
  console.error('Failed to load server module:', err);
  initError = {
    message: err?.message || String(err),
    stack: err?.stack || null,
    name: err?.name || 'Error',
  };
}

export default function handler(req: any, res: any) {
  if (initError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify(
        {
          success: false,
          error: 'Server Initialization Failure',
          details: initError,
        },
        null,
        2
      )
    );
  }

  try {
    return app(req, res);
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify(
        {
          success: false,
          error: 'Request Invocation Failure',
          message: err?.message || String(err),
          stack: err?.stack || null,
        },
        null,
        2
      )
    );
  }
}


