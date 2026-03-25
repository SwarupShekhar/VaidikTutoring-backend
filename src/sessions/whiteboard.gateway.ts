import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { WebSocket, Server } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// Message types matching y-websocket client
const messageSync = 0;
const messageAwareness = 1;

/**
 * Whiteboard Gateway for Yjs Synchronization (Raw WebSockets)
 * Endpoints: ws://api.com/whiteboard?[roomName]
 */
@WebSocketGateway({
  path: '/whiteboard',
})
export class WhiteboardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WhiteboardGateway.name);
  private docs = new Map<string, Y.Doc & { conns: Map<WebSocket, Set<number>>; awareness: any }>();

  handleConnection(client: WebSocket, request: any) {
    // Standard y-websocket sends to ws://host/path/roomName
    // We extract the last segment of the path as the room name
    const pathParts = request.url.split('/');
    const roomName = pathParts[pathParts.length - 1] || 'default';
    
    this.logger.log(`Client connecting to whiteboard room: ${roomName}`);

    const doc = this.getYDoc(roomName);
    doc.conns.set(client, new Set());

    // Listen for updates from other clients
    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin === client) return;
      this.sendUpdate(client, update);
    };
    doc.on('update', updateHandler);

    client.on('message', (message: any) => {
      this.handleMessage(client, doc, message);
    });

    client.on('close', () => {
      doc.conns.delete(client);
      doc.off('update', updateHandler);
      this.logger.log(`Client disconnected from whiteboard room: ${roomName}`);
      
      if (doc.conns.size === 0) {
        setTimeout(() => {
          if (doc.conns.size === 0) {
            this.docs.delete(roomName);
            doc.destroy();
            this.logger.log(`Whiteboard room ${roomName} destroyed (empty)`);
          }
        }, 5 * 60 * 1000); // 5 mins cleanup
      }
    });

    // Start sync step 1
    this.sendSyncStep1(doc, client);
  }

  handleDisconnect(client: WebSocket) {
    // Handled in client.on('close')
  }

  private getYDoc(roomName: string) {
    if (this.docs.has(roomName)) return this.docs.get(roomName);
    
    const doc = new Y.Doc() as any;
    doc.conns = new Map();
    doc.awareness = new awarenessProtocol.Awareness(doc);
    doc.awareness.setLocalState(null);
    
    doc.awareness.on('update', ({ added, updated, removed }, conn) => {
        const changedClients = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(encoder, 
            awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changedClients)
        );
        const message = encoding.toUint8Array(encoder);
        doc.conns.forEach((_, c) => {
            if (c.readyState === 1 /* OPEN */) c.send(message);
        });
    });

    this.docs.set(roomName, doc);
    return doc;
  }

  private handleMessage(conn: WebSocket, doc: any, message: any) {
    try {
      const uint8 = new Uint8Array(message);
      const decoder = decoding.createDecoder(uint8);
      const messageType = decoding.readVarUint(decoder);
      
      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
          if (encoding.length(encoder) > 1) {
            conn.send(encoding.toUint8Array(encoder));
          }
          break;
        }
        case messageAwareness: {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(doc.awareness, update, conn);
          break;
        }
      }
    } catch (err) {
      this.logger.error('Failed to handle whiteboard message:', err);
    }
  }

  private sendSyncStep1(doc: Y.Doc, conn: WebSocket) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    conn.send(encoding.toUint8Array(encoder));
  }

  private sendUpdate(conn: WebSocket, update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    conn.send(encoding.toUint8Array(encoder));
  }
}
