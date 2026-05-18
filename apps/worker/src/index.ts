function bootWorker() {
  console.log("⚙️ Worker Engine starting...");
  setInterval(() => {
    console.log("[Worker] Heartbeat OK - Polling for jobs...");
  }, 5000);
}

bootWorker();