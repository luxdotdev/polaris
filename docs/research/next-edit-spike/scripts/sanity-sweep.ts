// Sends run_model.py's own example (sweepai/sweep-next-edit-1.5B) to a running server, to check
// the prompt grammar reproduces the card's intended behaviour (add the time-of-day greeting).
const url = process.argv[2] ?? "http://127.0.0.1:8091";
const prompt = [
  "<|file_sep|>utils.py",
  'def get_time_of_day():\n    from datetime import datetime\n    hour = datetime.now().hour\n    if hour < 12:\n        return "morning"\n    elif hour < 18:\n        return "afternoon"\n    else:\n        return "evening"\n',
  "<|file_sep|>greet.py.diff",
  "original:",
  'def greet():\n    print("Hello!")',
  "updated:",
  'def greet(name):\n    print(f"Hello, {name}!")',
  "<|file_sep|>original/greet.py",
  'def greet(name):\n    print(f"Hello, {name}!")\n\ngreet("Alice")',
  "<|file_sep|>current/greet.py",
  'from utils import get_time_of_day\n\ndef greet(name):\n    print(f"Hello, {name}!")\n\ngreet("Alice")',
  "<|file_sep|>updated/greet.py",
].join("\n");
const r: any = await (await fetch(`${url}/completion`, { method: "POST", body: JSON.stringify({ prompt, n_predict: 512, temperature: 0, stop: ["<|file_sep|>", "</s>"] }) })).json();
console.log(r.content);
