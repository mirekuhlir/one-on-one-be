import { fromNodeHeaders } from "better-auth/node";
import type { Server as HTTPServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { auth } from "./auth.js";
import { type Game, LOBBY_PAGE_SIZE, lobbyStore } from "./lobbyStore.js";

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

		socket.on("join_lobby", (data?: { page?: number }) => {
			socket.join(LOBBY_ROOM);
			const page = data?.page ?? 0;
			const offset = page * LOBBY_PAGE_SIZE;
			const { games, total } = lobbyStore.getPublicWaitingGamesPaginated(LOBBY_PAGE_SIZE, offset);
			socket.emit("lobby_update", { games, total, page });
		});

		socket.on("request_lobby_page", (data: { page: number }) => {
			const page = Math.max(0, data?.page ?? 0);
			const offset = page * LOBBY_PAGE_SIZE;
			const { games, total } = lobbyStore.getPublicWaitingGamesPaginated(LOBBY_PAGE_SIZE, offset);
			socket.emit("lobby_update", { games, total, page });
		});

		socket.on("leave_lobby", () => {
			socket.leave(LOBBY_ROOM);
		});

		socket.on(
			"create_game",
			(
				data: { name: string; isPrivate: boolean },
				callback: (response: { roomId: string }) => void,
			) => {
				const user = socket.data.user;
				if (!user) return;
				const playerName = user.name || `Guest ${user.id.substring(0, 4)}`;

				const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
				const ROOM_CODE_LENGTH = 4;
				let roomId = '';
				let isUnique = false;

				while (!isUnique) {
					roomId = '';
					for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
						roomId += ROOM_CODE_ALPHABET.charAt(Math.floor(Math.random() * ROOM_CODE_ALPHABET.length));
					}
					// Verify uniqueness against active games
					if (!lobbyStore.getGame(roomId)) {
						isUnique = true;
					}
				}

				const game = lobbyStore.createGame(
					roomId,
					data?.name || "Game",
					{ id: user.id, name: playerName, socketId: socket.id },
					data?.isPrivate || false,
				);

				socket.join(roomId);

				if (typeof callback === "function") {
					callback({ roomId: game.id });
				} else {
					socket.emit("game_created", game.id);
				}

				if (!game.isPrivate) {
					const { games, total } = lobbyStore.getPublicWaitingGamesPaginated(LOBBY_PAGE_SIZE, 0);
					io.to(LOBBY_ROOM).emit("lobby_update", { games, total, page: 0 });
				}
			},
		);

		socket.on(
			"join_game",
			(
				data: { roomId: string },
				callback: (response: { success: boolean; game?: Game; error?: string }) => void,
			) => {
				const user = socket.data.user;
				if (!user) return;
				const playerName = user.name || `Guest ${user.id.substring(0, 4)}`;
				
				const roomId = data?.roomId?.toUpperCase();
				const result = lobbyStore.joinGame(roomId, {
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

		socket.on("leave_game", (data: { roomId: string }) => {
			if (!data?.roomId) return;

			const user = socket.data.user;
			if (!user) return;
			socket.leave(data.roomId);
			const game = lobbyStore.getGame(data.roomId);
			const remainingGame = lobbyStore.leaveGame(data.roomId, socket.id);

			if (game && !game.isPrivate) {
				// If game was public and is now gone or changed, update lobby
				const { games, total } = lobbyStore.getPublicWaitingGamesPaginated(LOBBY_PAGE_SIZE, 0);
				io.to(LOBBY_ROOM).emit("lobby_update", { games, total, page: 0 });
			}

			if (remainingGame) {
				io.to(data.roomId).emit("player_left", remainingGame);
			} else if (game) {
				// Game was cancelled (host left or no players remaining)
				io.to(data.roomId).emit("game_closed");
				io.in(data.roomId).socketsLeave(data.roomId);
			}
		});

		socket.on(
			"start_game",
			(
				data: { roomId: string },
				callback: (response: { success: boolean; error?: string }) => void,
			) => {
			if (!data?.roomId) return;

			const user = socket.data.user;
			if (!user) return;
			const game = lobbyStore.startGame(data.roomId, user.id);
			if (game) {
				io.to(game.id).emit("game_started", game);

				if (!game.isPrivate) {
					// Game started, so it shouldn't be in the public waiting list anymore
					const { games, total } = lobbyStore.getPublicWaitingGamesPaginated(LOBBY_PAGE_SIZE, 0);
					io.to(LOBBY_ROOM).emit("lobby_update", { games, total, page: 0 });
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
				const { games, total } = lobbyStore.getPublicWaitingGamesPaginated(LOBBY_PAGE_SIZE, 0);
				io.to(LOBBY_ROOM).emit("lobby_update", { games, total, page: 0 });
			}
		});
	});
}
