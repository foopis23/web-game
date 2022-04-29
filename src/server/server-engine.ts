import { Server, Socket } from "socket.io";
import { IClientToServerEvents, IInterServerEvents, IServerToClientEvents, ISocketData } from "../core/net";
import { ServerGame } from "./server-game";
import { AgonesSDK } from "@google-cloud/agones-sdk";

enum ServerState {
  LOBBY,
  GAME,
}

export class ServerEngine {
  protected state: ServerState;
  protected playerCount;
  protected game: ServerGame | undefined;
  protected serverSocket: Server;
  protected healthInterval: NodeJS.Timeout | undefined;

  constructor(port = 9500, origin = "", protected readonly maxPlayers: number = 2, protected readonly serverTickRate = 1000 / 60, protected readonly agonesSDK: AgonesSDK | undefined = undefined) {
    this.state = ServerState.LOBBY
    this.playerCount = 0;
    this.serverSocket = new Server<IClientToServerEvents, IServerToClientEvents, IInterServerEvents, ISocketData>({
      cors: {
        origin: origin,
        methods: ['GET', 'POST']
      }
    })

    this.serverSocket.on('connection', (socket: Socket) => this.onConnect(socket))
    this.serverSocket.listen(port)
    console.log(`Server is listening at ws://localhost:${port}`)

    if (this.agonesSDK) {
      agonesSDK.ready();

      agonesSDK.health();
      this.healthInterval = setInterval(() => {
        agonesSDK.health();
      }, 1000);
    }
  }

  protected onConnect(socket: Socket) {
    this.playerCount++;

    if (this.playerCount > this.maxPlayers) {
      this.playerCount--;
      socket.emit('FULL_SERVER')
      socket.disconnect()
      return
    }

    socket.on('disconnect', () => this.onDisconnect())
    // socket.on('playerInput', (input: IPlayerInputPacket) => handlePlayerInputPacket(input))

    if (this.playerCount < this.maxPlayers) {
      socket.emit('WAITING_FOR_PLAYERS', this.maxPlayers - this.playerCount)
      return
    }

    if (this.playerCount === this.maxPlayers) {
      if (this.agonesSDK) {
        this.agonesSDK.allocate();
      }

      this.startGame()
    }
  }

  protected onDisconnect() {
    this.playerCount--;

    if (this.state === ServerState.GAME) {
      if (this.playerCount < this.maxPlayers) {
        this.endGame()
      }
    }
  }

  protected startGame() {
    this.serverSocket.emit('INITIALIZE_GAME')

    this.game = new ServerGame(this.serverSocket, this.serverTickRate)
    this.state = ServerState.GAME

    this.serverSocket.emit('START_GAME')
  }

  protected endGame() {
    if (this.state !== ServerState.GAME) {
      return
    }

    this.serverSocket.emit('END_GAME')
    this.game?.destroy();
    this.game = undefined
    this.state = ServerState.LOBBY

    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }

    if (this.agonesSDK) {
      this.agonesSDK.shutdown().then(() => {
        process.exit(0);
      })
    }
  }
}