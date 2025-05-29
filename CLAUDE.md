# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

This is a collaborative electronic whiteboard application similar to Miro, with real-time synchronization capabilities.

### Structure
- **Frontend**: React application using Create React App with Socket.IO client for real-time features
- **Backend**: FastAPI server with Socket.IO for WebSocket communication and MongoDB for data persistence
- **Deployment**: Docker multi-stage build with nginx serving frontend and proxying API requests

### Key Components

**Frontend (`frontend/`)**:
- Single-page React app with drag-and-drop sticky notes
- Real-time collaboration via Socket.IO
- Custom pan/zoom viewport for infinite canvas
- Tailwind CSS for styling

**Backend (`backend/`)**:
- FastAPI with async/await pattern using Motor (async MongoDB driver)
- Socket.IO server for real-time events (note_created, note_updated, note_deleted, note_dragging)
- RESTful API under `/api` prefix for CRUD operations on whiteboards and notes
- Pydantic models for data validation

### Data Models
- **Whiteboard**: Container with name, notes array, timestamps
- **StickyNote**: Has content, position (x,y), dimensions, color, media_type (text/image/link), media_url

## Development Commands

### Frontend Development
```bash
cd frontend
npm start           # Development server on localhost:3000
npm test           # Run test suite
npm run build      # Production build
```

### Backend Development
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

### Code Quality (Backend)
```bash
cd backend
black .            # Format code
isort .            # Sort imports
flake8 .           # Lint code
mypy .             # Type checking
pytest             # Run tests
```

### Full Application (Docker)
```bash
docker build -t miro-clone .
docker run -p 80:80 -p 8001:8001 miro-clone
```

## Environment Variables

Backend requires:
- `MONGO_URL`: MongoDB connection string
- `DB_NAME`: Database name

Frontend requires:
- `REACT_APP_BACKEND_URL`: Backend server URL for API and Socket.IO

## Real-time Communication

Socket.IO events:
- `join_whiteboard`/`leave_whiteboard`: Room management
- `note_created`/`note_updated`/`note_deleted`: CRUD broadcasts
- `note_dragging`: Live position updates during drag operations

API endpoints follow RESTful patterns under `/api` prefix for whiteboards and nested notes resources.