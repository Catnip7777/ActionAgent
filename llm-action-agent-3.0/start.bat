@echo off
start "Server" cmd /c python "F:\vibecoding\llm-action-agent-3.0-release\server.py" --port 8765 --root "f:\vibecoding" --token "llm-agent-fixed-token"
start "HTTP Server" cmd /c python -m http.server 8080 --directory "F:\vibecoding\llm-action-agent-3.0-release"
echo Both servers started.
echo Server: port 8765
echo HTTP Server: port 8080
pause
