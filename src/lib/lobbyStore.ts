/**
 * lobbyStore – in-memory storage for game lobbies
 *
 * Manages creation, joining and leaving of players in game rooms.
 * Each game has max. 2 players (one-on-one), can be public or private.
 * Maintains socketId → game rooms index for proper cleanup on client disconnect.
 * Used together with socket.ts for real-time lobby functionality.
 */
export interface Player {
	id: string; // Session User ID
	name: string;
	socketId: string;
}

export interface Game {
	id: string;
	name: string;
	hostId: string;
	hostSocketId: string;
	players: Player[];
	isPrivate: boolean;
	status: "waiting" | "started";
}

export interface LobbyPlayerSummary {
	id: string;
	name: string;
}

export interface LobbyGameSummary {
	id: string;
	name: string;
	hostId: string;
	players: LobbyPlayerSummary[];
}

const MAX_PLAYERS_PER_GAME = 2;
export const LOBBY_PAGE_SIZE = 100;
const games: Map<string, Game> = new Map();
const socketIdToGames: Map<string, Set<string>> = new Map();

/**
	Called when a player creates a game (host) or joins a game.
  	The index is then used in socket.ts on "disconnect" to call leaveGame for each
 	room and clean up properly.
 */
function addToIndex(socketId: string, roomId: string): void {
	let set = socketIdToGames.get(socketId);
	if (!set) {
		set = new Set();
		socketIdToGames.set(socketId, set);
	}
	set.add(roomId);
}

/** Removes a socket-to-game mapping and cleans up empty sets to avoid memory leaks. */
function removeFromIndex(socketId: string, roomId: string): void {
	const set = socketIdToGames.get(socketId);
	if (set) {
		set.delete(roomId);
		if (set.size === 0) socketIdToGames.delete(socketId);
	}
}

export const lobbyStore = {
	createGame(
		roomId: string,
		name: string,
		host: Player,
		isPrivate: boolean,
	): Game {
		const newGame: Game = {
			id: roomId,
			name,
			hostId: host.id,
			hostSocketId: host.socketId,
			players: [host],
			isPrivate,
			status: "waiting",
		};
		games.set(roomId, newGame);
		addToIndex(host.socketId, roomId);
		return newGame;
	},

	getGame(roomId: string): Game | undefined {
		return games.get(roomId);
	},

	removeGame(roomId: string): boolean {
		return games.delete(roomId);
	},

	joinGame(roomId: string, player: Player): { game: Game | null; error?: string } {
		const game = games.get(roomId);
		if (!game) {
			return { game: null, error: "Game not found. It may have been closed if the host disconnected." };
		}
		if (game.status !== "waiting") {
			return { game: null, error: "Game has already started." };
		}
		
		const isAlreadyInGame = game.players.some((p) => p.socketId === player.socketId);
		
		if (!isAlreadyInGame) {
			if (game.players.length >= MAX_PLAYERS_PER_GAME) {
				return { game: null, error: "Game is full." };
			}
			game.players.push(player);
			addToIndex(player.socketId, roomId);
		}
		return { game };
	},

	leaveGame(roomId: string, socketId: string): Game | null {
		const game = games.get(roomId);
		if (game) {
			removeFromIndex(socketId, roomId);
			game.players = game.players.filter((p) => p.socketId !== socketId);
			// If host leaves or no players remain, the game is closed
			if (game.players.length === 0 || game.hostSocketId === socketId) {
				for (const p of game.players) {
					removeFromIndex(p.socketId, roomId);
				}
				games.delete(roomId);
				return null; // Indicates game was deleted
			}
			return game;
		}
		return null;
	},

	startGame(roomId: string, requestorId: string): Game | null {
		const game = games.get(roomId);
		if (game && game.status === "waiting" && game.hostId === requestorId) {
			game.status = "started";
			return game;
		}
		return null;
	},

	getPublicWaitingGamesPaginated(
		limit = LOBBY_PAGE_SIZE,
		offset = 0,
	): { games: LobbyGameSummary[]; total: number } {
		const publicGames: Game[] = [];
		for (const game of games.values()) {
			if (!game.isPrivate && game.status === "waiting" && game.players.length < MAX_PLAYERS_PER_GAME) {
				publicGames.push(game);
			}
		}
		publicGames.sort((a, b) => a.id.localeCompare(b.id));
		const total = publicGames.length;
		const slice = publicGames.slice(offset, offset + limit);
		const lobbyGames: LobbyGameSummary[] = slice.map((g) => ({
			id: g.id,
			name: g.name,
			hostId: g.hostId,
			players: g.players.map((p) => ({ id: p.id, name: p.name })),
		}));
		return { games: lobbyGames, total };
	},

	getGamesBySocketId(socketId: string): Game[] {
		const roomIds = socketIdToGames.get(socketId);
		if (!roomIds) return [];
		const result: Game[] = [];
		for (const id of roomIds) {
			const g = games.get(id);
			if (g) result.push(g);
		}
		return result;
	},
};
