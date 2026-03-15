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

const MAX_PLAYERS_PER_GAME = 2;
const games: Map<string, Game> = new Map();
const socketIdToGames: Map<string, Set<string>> = new Map();

/**
 * Adds a socket-to-game mapping to the index.
 * O(1) means constant time: lookup stays fast regardless of how many games exist.
 */
function addToIndex(socketId: string, gameId: string): void {
	let set = socketIdToGames.get(socketId);
	if (!set) {
		set = new Set();
		socketIdToGames.set(socketId, set);
	}
	set.add(gameId);
}

/** Removes a socket-to-game mapping and cleans up empty sets to avoid memory leaks. */
function removeFromIndex(socketId: string, gameId: string): void {
	const set = socketIdToGames.get(socketId);
	if (set) {
		set.delete(gameId);
		if (set.size === 0) socketIdToGames.delete(socketId);
	}
}

export const lobbyStore = {
	createGame(
		gameId: string,
		name: string,
		host: Player,
		isPrivate: boolean,
	): Game {
		const newGame: Game = {
			id: gameId,
			name,
			hostId: host.id,
			hostSocketId: host.socketId,
			players: [host],
			isPrivate,
			status: "waiting",
		};
		games.set(gameId, newGame);
		addToIndex(host.socketId, gameId);
		return newGame;
	},

	getGame(gameId: string): Game | undefined {
		return games.get(gameId);
	},

	removeGame(gameId: string): boolean {
		return games.delete(gameId);
	},

	joinGame(gameId: string, player: Player): { game: Game | null; error?: string } {
		const game = games.get(gameId);
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
			addToIndex(player.socketId, gameId);
		}
		return { game };
	},

	leaveGame(gameId: string, socketId: string): Game | null {
		const game = games.get(gameId);
		if (game) {
			removeFromIndex(socketId, gameId);
			game.players = game.players.filter((p) => p.socketId !== socketId);
			// If host leaves or no players remain, the game is closed
			if (game.players.length === 0 || game.hostSocketId === socketId) {
				for (const p of game.players) {
					removeFromIndex(p.socketId, gameId);
				}
				games.delete(gameId);
				return null; // Indicates game was deleted
			}
			return game;
		}
		return null;
	},

	startGame(gameId: string, requestorId: string): Game | null {
		const game = games.get(gameId);
		if (game && game.status === "waiting" && game.hostId === requestorId) {
			game.status = "started";
			return game;
		}
		return null;
	},

	getPublicWaitingGames(): Game[] {
		const publicGames: Game[] = [];
		for (const game of games.values()) {
			if (!game.isPrivate && game.status === "waiting") {
				publicGames.push(game);
			}
		}
		return publicGames;
	},

	getGamesBySocketId(socketId: string): Game[] {
		const gameIds = socketIdToGames.get(socketId);
		if (!gameIds) return [];
		const result: Game[] = [];
		for (const id of gameIds) {
			const g = games.get(id);
			if (g) result.push(g);
		}
		return result;
	},
};
