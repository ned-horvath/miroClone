from fastapi import FastAPI, APIRouter, HTTPException
from fastapi_socketio import SocketManager
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
import socketio

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI()

# Socket.IO manager
socket_manager = SocketManager(app=app, cors_allowed_origins=["*"])

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Models
class StickyNote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    x: float
    y: float
    width: float = 200
    height: float = 150
    color: str = "#ffeb3b"
    media_type: str = "text"  # text, image, link
    media_url: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class StickyNoteCreate(BaseModel):
    content: str
    x: float
    y: float
    width: float = 200
    height: float = 150
    color: str = "#ffeb3b"
    media_type: str = "text"
    media_url: Optional[str] = None

class StickyNoteUpdate(BaseModel):
    content: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    color: Optional[str] = None
    media_type: Optional[str] = None
    media_url: Optional[str] = None

class Whiteboard(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    notes: List[StickyNote] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class WhiteboardCreate(BaseModel):
    name: str

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Electronic Whiteboard API"}

@api_router.post("/whiteboards", response_model=Whiteboard)
async def create_whiteboard(whiteboard_data: WhiteboardCreate):
    whiteboard = Whiteboard(name=whiteboard_data.name)
    await db.whiteboards.insert_one(whiteboard.dict())
    return whiteboard

@api_router.get("/whiteboards", response_model=List[Whiteboard])
async def get_whiteboards():
    whiteboards = await db.whiteboards.find().to_list(100)
    return [Whiteboard(**wb) for wb in whiteboards]

@api_router.get("/whiteboards/{whiteboard_id}", response_model=Whiteboard)
async def get_whiteboard(whiteboard_id: str):
    whiteboard = await db.whiteboards.find_one({"id": whiteboard_id})
    if not whiteboard:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    return Whiteboard(**whiteboard)

@api_router.post("/whiteboards/{whiteboard_id}/notes", response_model=StickyNote)
async def create_note(whiteboard_id: str, note_data: StickyNoteCreate):
    # Check if whiteboard exists
    whiteboard = await db.whiteboards.find_one({"id": whiteboard_id})
    if not whiteboard:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    
    note = StickyNote(**note_data.dict())
    
    # Add note to whiteboard
    await db.whiteboards.update_one(
        {"id": whiteboard_id},
        {
            "$push": {"notes": note.dict()},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    # Broadcast to all connected clients
    await socket_manager.emit("note_created", {
        "whiteboard_id": whiteboard_id,
        "note": note.dict()
    })
    
    return note

@api_router.put("/whiteboards/{whiteboard_id}/notes/{note_id}", response_model=StickyNote)
async def update_note(whiteboard_id: str, note_id: str, note_data: StickyNoteUpdate):
    # Update note in whiteboard
    update_dict = {f"notes.$.{k}": v for k, v in note_data.dict(exclude_unset=True).items()}
    update_dict["notes.$.updated_at"] = datetime.utcnow()
    update_dict["updated_at"] = datetime.utcnow()
    
    result = await db.whiteboards.update_one(
        {"id": whiteboard_id, "notes.id": note_id},
        {"$set": update_dict}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Get updated note
    whiteboard = await db.whiteboards.find_one({"id": whiteboard_id})
    updated_note = next((note for note in whiteboard["notes"] if note["id"] == note_id), None)
    
    # Broadcast to all connected clients
    await socket_manager.emit("note_updated", {
        "whiteboard_id": whiteboard_id,
        "note": updated_note
    })
    
    return StickyNote(**updated_note)

@api_router.delete("/whiteboards/{whiteboard_id}/notes/{note_id}")
async def delete_note(whiteboard_id: str, note_id: str):
    result = await db.whiteboards.update_one(
        {"id": whiteboard_id},
        {
            "$pull": {"notes": {"id": note_id}},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Broadcast to all connected clients
    await socket_manager.emit("note_deleted", {
        "whiteboard_id": whiteboard_id,
        "note_id": note_id
    })
    
    return {"message": "Note deleted successfully"}

# Socket.IO events
@socket_manager.on('connect')
async def handle_connect(sid, environ):
    print(f"Client {sid} connected")

@socket_manager.on('disconnect')
async def handle_disconnect(sid):
    print(f"Client {sid} disconnected")

@socket_manager.on('join_whiteboard')
async def handle_join_whiteboard(sid, data):
    whiteboard_id = data.get('whiteboard_id')
    await socket_manager.enter_room(sid, whiteboard_id)
    print(f"Client {sid} joined whiteboard {whiteboard_id}")

@socket_manager.on('leave_whiteboard')
async def handle_leave_whiteboard(sid, data):
    whiteboard_id = data.get('whiteboard_id')
    await socket_manager.leave_room(sid, whiteboard_id)
    print(f"Client {sid} left whiteboard {whiteboard_id}")

@socket_manager.on('note_drag')
async def handle_note_drag(sid, data):
    # Broadcast real-time note position updates
    whiteboard_id = data.get('whiteboard_id')
    await socket_manager.emit("note_dragging", data, room=whiteboard_id, skip_sid=sid)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
