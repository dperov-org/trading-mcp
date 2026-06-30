export class WebUiEventHub {
  constructor() {
    this.clients = new Set();
    this.nextEventId = 0;
  }

  addClient(response) {
    this.clients.add(response);
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    this.sendTo(response, {
      type: "connected",
    });

    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  sendTo(response, payload) {
    const id = ++this.nextEventId;
    response.write(`id: ${id}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  broadcast(payload) {
    for (const response of this.clients) {
      this.sendTo(response, payload);
    }
  }

  close() {
    for (const response of this.clients) {
      response.end();
    }
    this.clients.clear();
  }
}
