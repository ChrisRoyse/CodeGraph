def log_to_file_and_stdout(msg):
    print(msg, flush=True)
    try:
        with open("/app/orchestrator_debug.log", "a") as f:
            f.write(msg + "\n")
    except Exception as e:
        print(f"[ORCHESTRATOR] Failed to write log: {e}", flush=True)
