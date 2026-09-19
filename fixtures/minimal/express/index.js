const express = require("express");
const app = express();
app.get("/", (q, s) => s.send("ok"));
app.listen(3000);
