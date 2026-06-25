const express = require("express");
const path = require("path");
const {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} = require("livekit-server-sdk");

const app = express();
const PORT = process.env.PORT || 5000;
const MAX_SPEAKERS = 5;

const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "Node backend is working",
  });
});

app.get("/api/livekit-config", (req, res) => {
  if (!LIVEKIT_URL) {
    return res.status(503).json({
      error: "LiveKit not configured.",
    });
  }

  res.json({
    url: LIVEKIT_URL,
  });
});

function getRoomService() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error("LiveKit secrets not configured.");
  }

  return new RoomServiceClient(
    LIVEKIT_URL,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
  );
}

function isRoomNotFound(error) {
  const message = String(
    error?.message || error || "",
  ).toLowerCase();

  return (
    message.includes("not found") ||
    message.includes("room does not exist") ||
    error?.code === 5 ||
    error?.status === 404
  );
}

async function listParticipantsSafe(roomName) {
  try {
    const roomService = getRoomService();
    return await roomService.listParticipants(roomName);
  } catch (error) {
    /*
      LiveKit rooms are temporary.

      Before the first person joins, or after the last person leaves,
      the room may not exist. Treat that as an empty room.
    */
    if (isRoomNotFound(error)) {
      return [];
    }

    throw error;
  }
}

async function countCurrentSpeakers(roomName) {
  const participants = await listParticipantsSafe(roomName);

  return participants.filter(
    (participant) =>
      participant.permission?.canPublish === true,
  ).length;
}

app.post("/api/livekit-token", async (req, res) => {
  try {
    const {
      username,
      roomName,
      role,
    } = req.body;

    if (!username || !roomName || !role) {
      return res.status(400).json({
        error:
          "username, roomName, and role are required.",
      });
    }

    if (
      !LIVEKIT_URL ||
      !LIVEKIT_API_KEY ||
      !LIVEKIT_API_SECRET
    ) {
      return res.status(500).json({
        error: "LiveKit secrets not configured.",
      });
    }

    const isHost = role === "host";
    const isSpeaker = role === "speaker";
    const canPublish = isHost || isSpeaker;

    if (canPublish) {
      const currentSpeakers =
        await countCurrentSpeakers(roomName);

      if (currentSpeakers >= MAX_SPEAKERS) {
        return res.status(409).json({
          error:
            `The room already has ${MAX_SPEAKERS} speakers.`,
        });
      }
    }

    const accessToken = new AccessToken(
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      {
        identity: username,
        name: username,
        ttl: "2h",
      },
    );

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish,
      canPublishData: canPublish,
      canPublishSources: canPublish
        ? [TrackSource.MICROPHONE]
        : [],
      hidden: false,
    });

    const token = await accessToken.toJwt();

    res.json({
      token,
      url: LIVEKIT_URL,
      role,
      room: roomName,
    });
  } catch (error) {
    console.error(
      "livekit-token error:",
      error,
    );

    res.status(500).json({
      error: error.message,
    });
  }
});

const speakerRequests = new Map();

app.post(
  "/api/livekit/request-speaker",
  (req, res) => {
    const {
      username,
      roomName,
    } = req.body;

    if (!username || !roomName) {
      return res.status(400).json({
        error:
          "username and roomName are required.",
      });
    }

    speakerRequests.set(
      `${roomName}::${username}`,
      {
        username,
        roomName,
        requestedAt: Date.now(),
      },
    );

    res.json({
      ok: true,
      message:
        `Speaker request submitted for ${username}.`,
    });
  },
);

app.post(
  "/api/livekit/approve-speaker",
  async (req, res) => {
    try {
      const {
        username,
        roomName,
      } = req.body;

      if (!username || !roomName) {
        return res.status(400).json({
          error:
            "username and roomName are required.",
        });
      }

      const speakers =
        await countCurrentSpeakers(roomName);

      if (speakers >= MAX_SPEAKERS) {
        return res.status(409).json({
          error:
            `The room already has ${MAX_SPEAKERS} speakers.`,
        });
      }

      const roomService =
        getRoomService();

      await roomService.updateParticipant(
        roomName,
        username,
        undefined,
        {
          canSubscribe: true,
          canPublish: true,
          canPublishData: true,
          canPublishSources: [
            TrackSource.MICROPHONE,
          ],
        },
      );

      speakerRequests.delete(
        `${roomName}::${username}`,
      );

      res.json({
        ok: true,
        message:
          `${username} approved as speaker.`,
      });
    } catch (error) {
      console.error(
        "approve-speaker error:",
        error,
      );

      res.status(500).json({
        error: error.message,
      });
    }
  },
);

app.post(
  "/api/livekit/remove-speaker",
  async (req, res) => {
    try {
      const {
        username,
        roomName,
      } = req.body;

      if (!username || !roomName) {
        return res.status(400).json({
          error:
            "username and roomName are required.",
        });
      }

      const roomService =
        getRoomService();

      await roomService.updateParticipant(
        roomName,
        username,
        undefined,
        {
          canSubscribe: true,
          canPublish: false,
          canPublishData: false,
          canPublishSources: [],
        },
      );

      res.json({
        ok: true,
        message:
          `${username} removed from speakers.`,
      });
    } catch (error) {
      console.error(
        "remove-speaker error:",
        error,
      );

      res.status(500).json({
        error: error.message,
      });
    }
  },
);

app.get(
  "/api/livekit/room-status",
  async (req, res) => {
    try {
      const {
        roomName,
      } = req.query;

      if (!roomName) {
        return res.status(400).json({
          error:
            "roomName query param is required.",
        });
      }

      const participants =
        await listParticipantsSafe(roomName);

      const speakers = participants.filter(
        (participant) =>
          participant.permission?.canPublish === true,
      );

      const listeners = participants.filter(
        (participant) =>
          participant.permission?.canPublish !== true,
      );

      const pendingSpeakerRequests = [];

      for (
        const request
        of speakerRequests.values()
      ) {
        if (request.roomName === roomName) {
          pendingSpeakerRequests.push(request);
        }
      }

      res.json({
        room: roomName,
        exists: participants.length > 0,
        participantCount:
          participants.length,
        speakerCount:
          speakers.length,
        maxSpeakers:
          MAX_SPEAKERS,

        speakers: speakers.map(
          (participant) => ({
            identity:
              participant.identity,
            joinedAt:
              participant.joinedAt,
          }),
        ),

        listeners: listeners.map(
          (participant) => ({
            identity:
              participant.identity,
            joinedAt:
              participant.joinedAt,
          }),
        ),

        pendingSpeakerRequests,
      });
    } catch (error) {
      console.error(
        "room-status error:",
        error,
      );

      res.status(500).json({
        error: error.message,
      });
    }
  },
);


// ─── WC 2026 Live Scores Proxy ───────────────────────────────────────────────
const FD_API_KEY = process.env.FD_API_KEY || "142fe1ba092d4d25af52f2b470a4f201";
const FD_BASE    = "https://api.football-data.org/v4";

async function fdFetch(path) {
  // Node 18+ has built-in fetch; for older Node use node-fetch
  const fetchFn = typeof fetch !== "undefined" ? fetch : require("node-fetch");
  const url = FD_BASE + path;
  const r = await fetchFn(url, {
    headers: { "X-Auth-Token": FD_API_KEY }
  });
  if (!r.ok) throw new Error(`football-data.org ${r.status}: ${await r.text()}`);
  return r.json();
}

// GET /api/live-scores?status=LIVE  (default: all WC matches today + live)
app.get("/api/live-scores", async (req, res) => {
  try {
    const status = req.query.status || "";
    // Fetch all WC 2026 matches — free tier may limit to certain dates
    // status filter: LIVE,IN_PLAY,PAUSED,FINISHED,SCHEDULED
    let path = "/competitions/WC/matches";
    if (status) path += "?status=" + encodeURIComponent(status);
    const data = await fdFetch(path);
    res.json(data);
  } catch (e) {
    console.error("live-scores error:", e.message);
    res.status(503).json({ error: e.message, matches: [] });
  }
});

// GET /api/wc-standings — group standings
app.get("/api/wc-standings", async (req, res) => {
  try {
    const data = await fdFetch("/competitions/WC/standings");
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html",
    ),
  );
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `WCPL 2026 running on port ${PORT}`,
    );
  },
);