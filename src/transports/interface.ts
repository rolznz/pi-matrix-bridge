import type { ExternalMessage } from "../types.js";

/**
 * Transport provider interface
 * Adapts a messenger platform (currently Matrix) to a common message API.
 */
export interface ITransportProvider {
  /** Transport type identifier */
  readonly type: string;

  /** Is the transport currently connected? */
  readonly isConnected: boolean;

  /**
   * Connect to the messenger service
   * @throws Error if connection fails
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the messenger service
   */
  disconnect(): Promise<void>;

  /**
   * Send a text message to a chat
   * @param chatId - Chat/channel identifier
   * @param text - Message content
   * @returns the sent message's id (for later editing), or "" if not sent
   */
  sendMessage(chatId: string, text: string): Promise<string>;

  /**
   * Edit a previously sent message in place (e.g. for live-streaming thinking)
   * @param chatId - Chat/channel identifier
   * @param messageId - Id returned by a prior sendMessage
   * @param text - Replacement content
   */
  editMessage(chatId: string, messageId: string, text: string): Promise<void>;

  /**
   * Send typing indicator to a chat
   * @param chatId - Chat/channel identifier
   */
  sendTyping(chatId: string): Promise<void>;

  /**
   * Clear the typing indicator for a chat (e.g. after an interrupted turn)
   * @param chatId - Chat/channel identifier
   */
  stopTyping(chatId: string): Promise<void>;

  /**
   * Register callback for incoming messages
   * @param handler - Message handler function
   */
  onMessage(handler: (message: ExternalMessage) => void): void;

  /**
   * Register callback for errors
   * @param handler - Error handler function
   */
  onError(handler: (error: Error) => void): void;
}
