import { fromNodeHeaders } from "better-auth/node";
import type { Server as HTTPServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { auth } from "./auth.js";
import { type Game, lobbyStore } from "./lobbyStore.js";

interface CustomSocketData {
	user?: {
		id: string;
		name?: string | null;
	};
}

export function initSocketServer(httpServer: HTTPServer) {
	const io = new SocketIOServer<
		// biome-ignore lint/suspicious/noExplicitAny: Generic types for socket.io require any for flexibility in events
		Record<string, any>,
		// biome-ignore lint/suspicious/noExplicitAny: Generic types for socket.io require any for flexibility in events
		Record<string, any>,
		// biome-ignore lint/suspicious/noExplicitAny: Generic types for socket.io require any for flexibility in events
		Record<string, any>,
		CustomSocketData
	>(httpServer, {
		cors: {
			origin: process.env.CLIENT_ORIGIN
				? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim())
				: false,
			methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			credentials: true,
		},
	});

	io.engine.on("connection_error", (err) => {
		console.error("Socket.io engine connection error:");
		console.error(" - code:", err.code);
		console.error(" - message:", err.message);
		console.error(" - context:", err.context);
	});

	io.use(async (socket, next) => {
		try {
			const session = await auth.api.getSession({
				headers: fromNodeHeaders(socket.request.headers),
			});

			if (!session) {
				console.error(`Socket authentication failed: No session found for socket id: ${socket.id}`);
				return next(new Error("Unauthorized access"));
			}

			// Store user information in socket data
			socket.data.user = session.user;
			next();
		} catch (error) {
			console.error(`Socket authentication exception for socket ${socket.id}:`, error);
			next(new Error("Authentication error"));
		}
	});

	const LOBBY_ROOM = "lobby";

	io.on("connection", (socket) => {
		console.log(`Socket connected: ${socket.id} (User: ${socket.data.user?.id})`);

		socket.on("join_lobby", () => {
			socket.join(LOBBY_ROOM);
			socket.emit("lobby_update", lobbyStore.getPublicWaitingGames());
		});

		socket.on("leave_lobby", () => {
			socket.leave(LOBBY_ROOM);
		});

		socket.on(
			"create_game",
			(
				data: { name: string; isPrivate: boolean },
				callback: (response: { gameId: string }) => void,
			) => {
				const user = socket.data.user;
				if (!user) return;
				const playerName = user.name || `Guest ${user.id.substring(0, 4)}`;

				const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
				const ROOM_CODE_LENGTH = 4;
				let gameId = '';
				let isUnique = false;

				while (!isUnique) {
					gameId = '';
					for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
						gameId += ROOM_CODE_ALPHABET.charAt(Math.floor(Math.random() * ROOM_CODE_ALPHABET.length));
					}
					// Verify uniqueness against active games
					if (!lobbyStore.getGame(gameId)) {
						isUnique = true;
					}
				}

				const game = lobbyStore.createGame(
					gameId,
					data?.name || "Game",
					{ id: user.id, name: playerName, socketId: socket.id },
					data?.isPrivate || false,
				);

				socket.join(gameId);

				if (typeof callback === "function") {
					callback({ gameId: game.id });
				} else {
					socket.emit("game_created", game.id);
				}

				if (!game.isPrivate) {
					io.to(LOBBY_ROOM).emit("lobby_update", lobbyStore.getPublicWaitingGames());
				}
			},
		);

		socket.on(
			"join_game",
			(
				data: { gameId: string },
				callback: (response: { success: boolean; game?: Game; error?: string }) => void,
			) => {
				const user = socket.data.user;
				if (!user) return;
				const playerName = user.name || `Guest ${user.id.substring(0, 4)}`;
				
				const gameId = data?.gameId?.toUpperCase();
				const result = lobbyStore.joinGame(gameId, {
					id: user.id,
					name: playerName,
					socketId: socket.id,
				});

				if (result.game) {
					socket.join(result.game.id);
					if (typeof callback === "function") {
						callback({ success: true, game: result.game });
					}
					// Notify other players in the game room
					io.to(result.game.id).emit("player_joined", result.game);
				} else {
					if (typeof callback === "function") {
						callback({
							success: false,
							error: result.error || "Game not found, already started, or full",
						});
					}
				}
			},
		);

		socket.on("leave_game", (data: { gameId: string }) => {
			if (!data?.gameId) return;

			const user = socket.data.user;
			if (!user) return;
			socket.leave(data.gameId);
			const game = lobbyStore.getGame(data.gameId);
			const remainingGame = lobbyStore.leaveGame(data.gameId, socket.id);

			if (game && !game.isPrivate) {
				// If game was public and is now gone or changed, update lobby
				io.to(LOBBY_ROOM).emit("lobby_update", lobbyStore.getPublicWaitingGames());
			}

			if (remainingGame) {
				io.to(data.gameId).emit("player_left", remainingGame);
			} else if (game) {
				// Game was cancelled (host left or no players remaining)
				io.to(data.gameId).emit("game_closed");
				io.in(data.gameId).socketsLeave(data.gameId);
			}
		});

		socket.on(
			"start_game",
			(
				data: { gameId: string },
				callback: (response: { success: boolean; error?: string }) => void,
			) => {
			if (!data?.gameId) return;

			const user = socket.data.user;
			if (!user) return;
			const game = lobbyStore.startGame(data.gameId, user.id);
			if (game) {
				io.to(game.id).emit("game_started", game);

				if (!game.isPrivate) {
					// Game started, so it shouldn't be in the public waiting list anymore
					io.to(LOBBY_ROOM).emit("lobby_update", lobbyStore.getPublicWaitingGames());
				}

				if (typeof callback === "function") {
					callback({ success: true });
				}
			} else {
				if (typeof callback === "function") {
					callback({ success: false, error: "Cannot start game or not authorized" });
				}
			}
		});

		socket.on("disconnect", (reason) => {
			console.log(`Socket disconnected: ${socket.id}, reason: ${reason}`);
			const user = socket.data.user;
			if (!user) return; // In case they disconnected before auth completed

			const playerGames = lobbyStore.getGamesBySocketId(socket.id);

			let lobbyChanged = false;

			for (const game of playerGames) {
				const remainingGame = lobbyStore.leaveGame(game.id, socket.id);
				if (!game.isPrivate && game.status === "waiting") {
					lobbyChanged = true;
				}
				if (remainingGame) {
					io.to(game.id).emit("player_left", remainingGame);
				} else {
					// Game was cancelled (host left or no players remaining)
					io.to(game.id).emit("game_closed");
					io.in(game.id).socketsLeave(game.id);
				}
			}

			if (lobbyChanged) {
				io.to(LOBBY_ROOM).emit("lobby_update", lobbyStore.getPublicWaitingGames());
			}
		});
	});
}
