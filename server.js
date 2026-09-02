require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  maxHttpBufferSize: 5e6
});

const sessionMiddleware = session({
  secret: "metaverse-secret-key",
  resave: false,
  saveUninitialized: false
});

const chatHistory = [];
const MAX_CHAT_HISTORY = 15;

const whiteboardHistory = [];
const MAX_WHITEBOARD_HISTORY = 5000;



let currentMeetingScreen = {
  type: "video",
  src: "/assets/femur.mp4",
  title: "Femur",
  index: 0
};

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError &&
        err.status === 400 &&
        "body" in err) {

        console.error("Invalid JSON:");
        console.error(err.body);

        return res.status(400).json({
            error: "Invalid JSON"
        });
    }

    next(err);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(sessionMiddleware);

const usersDb = [
  {
    username: "nikola",
    password: "1234",
    name: "King Nikola",
    role: "admin",
    color: "#9333ea"
  },
  {
    username: "teacher",
    password: "1234",
    name: "Teacher",
    role: "teacher",
    color: "#CC6912"
  },
  {
    username: "student",
    password: "1234",
    name: "Student",
    role: "student",
    color: "#16a34a"
  },
  {
    username: "guest",
    password: "1234",
    name: "Guest",
    role: "guest",
    color: "#dc2626"
  }
];
/* old, before moodle integration
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }

  next();
}
*/

function requireLogin(req, res, next) {
  if (!req.session.user && !req.session.fromMoodle) {
    return res.redirect("/login.html");
  }

  next();
}

app.get("/moodle-entry", (req, res) => {
  const userid = req.query.userid;

  if (!userid) {
    return res.status(400).send("Missing Moodle userid");
  }

  req.session.fromMoodle = true;
  req.session.moodleUserId = userid;

  console.log("Moodle user ID:", userid);

  res.redirect("/lobi_shine_h.html");
});

app.get("/", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }

  res.redirect("/index.html");
});

app.post("/login", (req, res) => {
  const { username, password, lobby } = req.body;

  const user = usersDb.find(
    u => u.username === username && u.password === password
  );

  if (!user) {
    return res.redirect("/login.html?error=1");
  }

  req.session.user = {
    username: user.username,
    name: user.name,
    role: user.role,
    color: user.color
  };

  req.session.lobby = lobby === "lobi3_shine_h" ? "lobi3_shine_h" : "index";
  
  return res.redirect(
    lobby === "lobi3_shine_h" ? "/lobi3_shine_h.html" : "/index.html"
  );
});
app.get("/lobby", requireLogin, (req, res) => {
  res.json({
    url: req.session.lobby === "lobi3_shine_h"
      ? "/lobi3_shine_h.html"
      : "/index.html"
  });
});
/* pre moodle
app.get("/me", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  res.json(req.session.user);
});
*/

app.get("/me", (req, res) => {

  if (req.session.user) {
    return res.json(req.session.user);
  }

  if (req.session.fromMoodle) {
    return res.json({
      username: "moodle",
      name: "Moodle User",
      role: "student",
      color: "#16a34a"
    });
  }

  return res.status(401).json({
    error: "Not logged in"
  });
});  app.get("/me", (req, res) => {

    if (req.session.user) {
      return res.json(req.session.user);
    }

    if (req.session.fromMoodle) {
      return res.json({
        username: "moodle",
        name: "Moodle User",
        role: "student",
        color: "#16a34a"
      });
    }

    return res.status(401).json({
      error: "Not logged in"
    });
  });

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

app.use("/index.html", requireLogin);
app.use("/lobi3_shine_h.html", requireLogin);
app.use("/rooms", requireLogin);

app.use(express.static(path.join(__dirname, "public")));

io.engine.use(sessionMiddleware);

const connectedUsers = {};

function getUsersInRoom(roomName) {
  const usersInRoom = {};

  Object.keys(connectedUsers).forEach(id => {
    if (connectedUsers[id].room === roomName) {
      usersInRoom[id] = connectedUsers[id];
    }
  });

  return usersInRoom;
}


function getOnlineUsers() {
  return Object.values(connectedUsers).map(user => ({
    name: user.name,
    role: user.role,
    color: user.color,
    room: user.room
  }));
}

function emitOnlineUsers() {
  io.emit("onlineUsersUpdate", getOnlineUsers());
}
// Moodle completition function
async function completeMoodleActivity(userid, cmid, score) {

  // 1. ACTIVITY COMPLETION
  const completionParams = new URLSearchParams({
    wstoken: process.env.MOODLE_TOKEN,
    wsfunction: "core_completion_override_activity_completion_status",
    moodlewsrestformat: "json",
    userid: String(userid),
    cmid: String(cmid),
    newstate: "1"
  });

  const completionUrl =
    `${process.env.MOODLE_URL}/webservice/rest/server.php?${completionParams.toString()}`;

  const completionResponse = await fetch(completionUrl);
  const completionData = await completionResponse.json();

  if (completionData.exception) {
    console.error("Moodle completion error:", completionData);
    throw new Error(
      completionData.message || "Moodle completion failed"
    );
  }


  // 2. SCORE
  const scoreParams = new URLSearchParams({
    wstoken: process.env.MOODLE_TOKEN,
    wsfunction: "local_rdm_update_score",
    moodlewsrestformat: "json",
    userid: String(userid),
    courseid: "2",
    score: String(score)
  });

  const scoreUrl =
    `${process.env.MOODLE_URL}/webservice/rest/server.php?${scoreParams.toString()}`;

  const scoreResponse = await fetch(scoreUrl);
  const scoreData = await scoreResponse.json();

  if (scoreData.exception) {
    console.error("Moodle score error:", scoreData);
    throw new Error(
      scoreData.message || "Moodle score update failed"
    );
  }


  return {
    completion: completionData,
    score: scoreData
  };
}
async function updateMoodleScore(userid, courseid, score) {

  const params = new URLSearchParams({
    wstoken: process.env.MOODLE_TOKEN,
    wsfunction: "local_rdm_update_score",
    moodlewsrestformat: "json",
    userid: String(userid),
    courseid: String(courseid),
    score: String(score)
  });

  const url =
    `${process.env.MOODLE_URL}/webservice/rest/server.php?${params.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.exception) {
    console.error("Moodle score error:", data);
    throw new Error(data.message || "Moodle score update failed");
  }

  return data;
}
app.post("/api/moodle/score", requireLogin, async (req, res) => {
  try {
    const moodleUserId = req.session.moodleUserId;
    const score = Number(req.body.score);

    if (!moodleUserId) {
      return res.status(400).json({
        success: false,
        error: "Missing Moodle user ID in session"
      });
    }

    if (!Number.isFinite(score)) {
      return res.status(400).json({
        success: false,
        error: "Invalid score"
      });
    }

    const result = await updateMoodleScore(
      moodleUserId,
      2,
      score
    );

    res.json({
      success: true,
      moodle: result
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
app.post("/api/moodle/complete-test", requireLogin, async (req, res) => {
  try {
    const moodleUserId = req.session.moodleUserId;

    if (!moodleUserId) {
      return res.status(400).json({
        success: false,
        error: "Missing Moodle user ID in session"
      });
    }

    const result = await completeMoodleActivity(moodleUserId, 5,73);

    res.json({
      success: true,
      moodle: result
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});



io.on("connection", socket => {
  
/* pre moodle
  const session = socket.request.session;

  if (!session || !session.user) {
    socket.disconnect();
    return;
  }

  const user = session.user;
  
*/   
  const session = socket.request.session;

  if (!session || (!session.user && !session.fromMoodle)) {
    socket.disconnect();
    return;
  }

  const user = session.user || {
    username: "moodle",
    name: "Moodle User",
    role: "student",
    color: "#16a34a"
  };
  
  
  connectedUsers[socket.id] = {
    id: socket.id,
    name: user.name,
    role: user.role,
    color: user.color,
    room: "lobby",
    x: 0,
    y: 1.6,
    z: 4,
    ry: 0
  };

  socket.join("lobby");

  socket.emit("chatHistory", chatHistory);
  socket.emit("whiteboardHistory", whiteboardHistory);
  socket.emit("meetingScreenChanged", currentMeetingScreen);

  socket.to("lobby").emit("user-connected", connectedUsers[socket.id]);
  
  
  emitOnlineUsers();

  socket.on("joinRoom", roomName => {
    if (!connectedUsers[socket.id]) return;

    const oldRoom = connectedUsers[socket.id].room || "lobby";
    const newRoom = roomName || "lobby";

    socket.leave(oldRoom);
    socket.to(oldRoom).emit("user-disconnected", socket.id);

    socket.join(newRoom);

    connectedUsers[socket.id].room = newRoom;
    connectedUsers[socket.id].x = 0;
    connectedUsers[socket.id].y = 1.6;
    connectedUsers[socket.id].z = 4;
    connectedUsers[socket.id].ry = 0;

    socket.emit("current-users", getUsersInRoom(newRoom));
    socket.to(newRoom).emit("user-connected", connectedUsers[socket.id]);
	
    emitOnlineUsers();

    if (newRoom === "meeting") {
      socket.emit("meetingScreenChanged", currentMeetingScreen);
    }
  });

  socket.on("chatMessage", message => {
    if (!connectedUsers[socket.id]) return;
    if (!message) return;

    const cleanMessage = String(message).trim().substring(0, 300);
    if (!cleanMessage) return;

    const chatData = {
      user: user.name,
      role: user.role,
      color: user.color,
      message: cleanMessage,
      time: new Date().toISOString()
    };

    chatHistory.push(chatData);

    if (chatHistory.length > MAX_CHAT_HISTORY) {
      chatHistory.shift();
    }

    io.emit("chatMessage", chatData);
  });

  socket.on("playerMove", data => {
    if (!connectedUsers[socket.id]) return;

    connectedUsers[socket.id].x = Number(data.x) || 0;
    connectedUsers[socket.id].y = Number(data.y) || 1.6;
    connectedUsers[socket.id].z = Number(data.z) || 4;
    connectedUsers[socket.id].ry = Number(data.ry) || 0;

    const room = connectedUsers[socket.id].room || "lobby";

    socket.to(room).emit("playerMoved", connectedUsers[socket.id]);
    emitOnlineUsers();
  });

  
  socket.on("whiteboardImage", data => {

    if (!connectedUsers[socket.id]) return;
    if (!data) return;

    const imageData = {
      type: "image",
      image: data.image,
      x: Number(data.x) || 100,
      y: Number(data.y) || 100,
      width: Number(data.width) || 300,
      height: Number(data.height) || 200
    };

    whiteboardHistory.push(imageData);

    if (whiteboardHistory.length > MAX_WHITEBOARD_HISTORY) {
      whiteboardHistory.shift();
    }

    io.emit("whiteboardImage", imageData);

  });
  
  
  socket.on("whiteboardDraw", line => {
    if (!connectedUsers[socket.id]) return;
    if (!line) return;

    const drawData = {
      type: "line",
      x1: Number(line.x1),
      y1: Number(line.y1),
      x2: Number(line.x2),
      y2: Number(line.y2),
      color: line.color || "#000000",
      size: Number(line.size) || 3
    };

    whiteboardHistory.push(drawData);

    if (whiteboardHistory.length > MAX_WHITEBOARD_HISTORY) {
      whiteboardHistory.shift();
    }

    socket.broadcast.emit("whiteboardDraw", drawData);
  });

  socket.on("whiteboardText", data => {
    if (!connectedUsers[socket.id]) return;
    if (!data) return;

    const textData = {
      type: "text",
      text: String(data.text || "").trim().substring(0, 120),
      x: Number(data.x),
      y: Number(data.y),
      color: data.color || "#000000",
      size: Number(data.size) || 28
    };

    if (!textData.text) return;

    whiteboardHistory.push(textData);

    if (whiteboardHistory.length > MAX_WHITEBOARD_HISTORY) {
      whiteboardHistory.shift();
    }

    io.emit("whiteboardText", textData);
  });

  socket.on("whiteboardClear", () => {
    if (!connectedUsers[socket.id]) return;

    whiteboardHistory.length = 0;
    io.emit("whiteboardClear");
  });

  socket.on("changeMeetingScreen", screen => {
    if (!connectedUsers[socket.id]) return;

    const currentUser = connectedUsers[socket.id];

	/*
    if (currentUser.role !== "admin") {
      return;
    }

	*/
	
    if (!screen || !screen.src) {
      return;
    }

	currentMeetingScreen = {
	  type: screen.type || "video",
	  src: String(screen.src),
	  title: String(screen.title || "Screen"),
	  index: Number(screen.index) || 0
	};

    io.to("meeting").emit("meetingScreenChanged", currentMeetingScreen);
  });

  socket.on("disconnect", () => {
    if (connectedUsers[socket.id]) {
      const room = connectedUsers[socket.id].room || "lobby";
      delete connectedUsers[socket.id];
      socket.to(room).emit("user-disconnected", socket.id);
    }
  });
});

server.listen(31080, () => {
  console.log("Server running");
});