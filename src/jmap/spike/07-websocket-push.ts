/**
 * 07-websocket-push.ts — Real-time events via WebSocket (Vector JM-06)
 *
 * Objective: Connect to Stalwart's WebSocket endpoint, send
 *            WebSocketPushEnable and capture a StateChange event.
 *
 * NOTE: jmap-jam only exposes `connectEventSource()` (SSE / EventSource).
 *       This test uses the native WebSocket API (RFC 8887) directly to
 *       evaluate whether the push path works and to document jmap-jam's
 *       coverage gap for WebSocket push.
 *
 * Run: pnpm spike:jmap src/jmap/spike/07-websocket-push.ts
 */

import { createClient, report } from './_config.ts';

/** Timeout in ms to wait for a StateChange event. */
const PUSH_TIMEOUT_MS = 30_000;

interface WebSocketPushEnable {
  '@type': 'WebSocketPushEnable';
  dataTypes: null; // null = all types
  pushState?: string;
}

interface StateChange {
  '@type': 'StateChange';
  changed: Record<string, Record<string, string>>;
}

async function main(): Promise<void> {
  const jam = createClient();

  // 1. Get session to extract WebSocket URL
  const session = await jam.session;

  // Stalwart exposes the WS URL in the websocket capability
  const wsCap = session.capabilities['urn:ietf:params:jmap:websocket'] as Record<string, unknown> | undefined;
  let wsUrl = (wsCap?.url as string) || '';

  if (!wsUrl) {
    report('JM-06', 'BLOCKED', 'Could not find WebSocket URL in capabilities.');
    return;
  }

  // Rewrite configured hostnames to localhost for docker dev
  if (wsUrl.includes('boxplot.local')) {
    wsUrl = wsUrl.replace(/wss?:\/\/[^\/]+/, 'ws://localhost:8080');
  }

  console.log(`WebSocket URL: ${wsUrl}`);
  console.log(`Timeout: ${PUSH_TIMEOUT_MS}ms`);

  // 2. Connect and enable push
  const basicAuth = process.env.JMAP_BASIC_AUTH;
  const authHeader = `Basic ${Buffer.from(basicAuth || '').toString('base64')}`;

  // Use the 'ws' package to inject headers, since native WebSocket doesn't support it
  const { default: NodeWebSocket } = await import('ws');

  const ws = new NodeWebSocket(wsUrl, ['jmap'], {
    headers: {
      Authorization: authHeader,
    },
  });

  const result = await new Promise<{
    success: boolean;
    details: string;
  }>((resolve) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve({
        success: false,
        details:
          'Timeout waiting for StateChange event.\n' +
          'This may mean no changes occurred during the wait period.\n' +
          'Try triggering an email action from another client during the test.',
      });
    }, PUSH_TIMEOUT_MS);

    ws.on('open', () => {
      console.log('WebSocket connected.');

      // Send WebSocketPushEnable (RFC 8887)
      const enableMsg: WebSocketPushEnable = {
        '@type': 'WebSocketPushEnable',
        dataTypes: null,
      };
      ws.send(JSON.stringify(enableMsg));
      console.log('Sent WebSocketPushEnable. Waiting for StateChange...');
    });

    ws.on('message', (dataRaw) => {
      const data = String(dataRaw);
      console.log(`Received: ${data.substring(0, 200)}`);

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;

        if (parsed['@type'] === 'StateChange') {
          const stateChange = parsed as unknown as StateChange;
          clearTimeout(timeout);
          ws.close();
          resolve({
            success: true,
            details: [
              'StateChange received!',
              `Changed accounts: ${Object.keys(stateChange.changed).join(', ')}`,
              `Payload: ${JSON.stringify(stateChange.changed, null, 2)}`,
            ].join('\n'),
          });
        }
      } catch {
        // Not JSON or not a StateChange — continue waiting
      }
    });

    ws.on('error', (err: any) => {
      clearTimeout(timeout);
      ws.close();
      resolve({
        success: false,
        details: `WebSocket error: ${err.message}`,
      });
    });

    ws.on('close', () => {
      console.log('WebSocket closed.');
    });
  });

  // 3. Also note jmap-jam's SSE (connectEventSource) availability
  const sseNote =
    '\n\njmap-jam SSE: connectEventSource() is available but not tested here.\n' +
    'It uses Server-Sent Events, not WebSocket (RFC 8887).\n' +
    'For real-time push in Tauri, WebSocket is preferred.';

  report('JM-06', result.success ? 'PASS' : 'FAIL', result.details + sseNote);
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
