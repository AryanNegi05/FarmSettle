#!/bin/bash
# Activate Python virtual environment
if [ -d ".venv" ]; then
    source .venv/bin/activate
else
    source venv/bin/activate
fi
echo "✅ Virtual environment activated!"
echo "📦 Python version: $(python --version)"
echo "🔥 Firebase Admin: $(python -c 'import firebase_admin; print(firebase_admin.__version__)' 2>/dev/null || echo 'not installed')"
echo ""
echo "💡 To start the backend:"
echo "   uvicorn app.main:app --reload"
