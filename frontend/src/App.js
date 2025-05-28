import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import {
  DndContext,
  useDraggable,
  DragOverlay,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { v4 as uuidv4 } from 'uuid';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Sticky Note Component
const StickyNote = ({ note, onUpdate, onDelete, onDrag, isCollaborativeUpdate, isDragging: externalIsDragging }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(note.content);
  const textareaRef = useRef(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: internalIsDragging,
  } = useDraggable({
    id: note.id,
    disabled: isEditing,
  });

  const isDragging = internalIsDragging || externalIsDragging;

  const style = {
    position: 'absolute',
    left: `${note.x}px`,
    top: `${note.y}px`,
    width: `${note.width}px`,
    height: `${note.height}px`,
    backgroundColor: note.color,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : 10,
  };

  useEffect(() => {
    setContent(note.content);
  }, [note.content]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (content.trim() !== note.content) {
      onUpdate(note.id, { content: content.trim() });
    }
    setIsEditing(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setContent(note.content);
      setIsEditing(false);
    }
  };

  const renderContent = () => {
    if (note.media_type === 'link' && note.media_url) {
      return (
        <div className="space-y-2">
          <a 
            href={note.media_url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline text-sm break-all"
          >
            {note.media_url}
          </a>
          {content && (
            <p className="text-sm text-gray-700">{content}</p>
          )}
        </div>
      );
    }
    
    if (note.media_type === 'image' && note.media_url) {
      return (
        <div className="space-y-2">
          <img 
            src={note.media_url} 
            alt="Note content" 
            className="w-full h-20 object-cover rounded"
          />
          {content && (
            <p className="text-sm text-gray-700">{content}</p>
          )}
        </div>
      );
    }
    
    return content;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sticky-note bg-yellow-200 border border-yellow-300 rounded-lg shadow-lg transition-all duration-200 ${
        isDragging ? 'shadow-xl scale-105' : 'hover:shadow-md'
      } ${isCollaborativeUpdate ? 'ring-2 ring-blue-400' : ''}`}
    >
      {/* Header with drag handle and controls */}
      <div 
        className="flex justify-between items-center p-2 bg-black bg-opacity-5 rounded-t-lg"
        {...attributes}
        {...listeners}
        style={{ cursor: 'move' }}
      >
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-red-400 rounded-full"></div>
          <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
        </div>
        <div className="flex space-x-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className="text-gray-600 hover:text-gray-800 text-xs pointer-events-auto"
            title="Edit"
            style={{ cursor: 'pointer' }}
          >
            ✏️
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            className="text-gray-600 hover:text-red-600 text-xs pointer-events-auto"
            title="Delete"
            style={{ cursor: 'pointer' }}
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="p-3 h-full overflow-hidden">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyPress}
            className="w-full h-full resize-none border-none outline-none bg-transparent text-sm"
            placeholder="Enter your note..."
          />
        ) : (
          <div 
            className="w-full h-full text-sm cursor-text overflow-auto"
            onClick={() => setIsEditing(true)}
          >
            {renderContent() || (
              <span className="text-gray-500 italic">Click to edit...</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Main Whiteboard Component
const Whiteboard = ({ whiteboardId }) => {
  const [notes, setNotes] = useState([]);
  const [socket, setSocket] = useState(null);
  const [viewPort, setViewPort] = useState({ x: 0, y: 0, scale: 1 });
  const [isConnected, setIsConnected] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const whiteboardRef = useRef(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });

  // Configure sensors for @dnd-kit
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 10, // Minimum distance before drag starts
    },
  });
  
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 250,
      tolerance: 5,
    },
  });
  
  const sensors = useSensors(mouseSensor, touchSensor);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(BACKEND_URL, {
      path: '/socket.io/',
      transports: ['websocket', 'polling']
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      newSocket.emit('join_whiteboard', { whiteboard_id: whiteboardId });
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('note_created', (data) => {
      if (data.whiteboard_id === whiteboardId) {
        setNotes(prev => [...prev, data.note]);
      }
    });

    newSocket.on('note_updated', (data) => {
      if (data.whiteboard_id === whiteboardId) {
        setNotes(prev => prev.map(note => 
          note.id === data.note.id ? { ...data.note, isCollaborativeUpdate: true } : note
        ));
        // Remove collaborative update indicator after a short delay
        setTimeout(() => {
          setNotes(prev => prev.map(note => ({ ...note, isCollaborativeUpdate: false })));
        }, 1000);
      }
    });

    newSocket.on('note_deleted', (data) => {
      if (data.whiteboard_id === whiteboardId) {
        setNotes(prev => prev.filter(note => note.id !== data.note_id));
      }
    });

    newSocket.on('note_dragging', (data) => {
      if (data.whiteboard_id === whiteboardId) {
        setNotes(prev => prev.map(note => 
          note.id === data.note_id ? { ...note, x: data.x, y: data.y, isCollaborativeUpdate: true } : note
        ));
      }
    });

    return () => {
      newSocket.emit('leave_whiteboard', { whiteboard_id: whiteboardId });
      newSocket.close();
    };
  }, [whiteboardId]);

  // Load whiteboard data
  useEffect(() => {
    const loadWhiteboard = async () => {
      try {
        const response = await axios.get(`${API}/whiteboards/${whiteboardId}`);
        setNotes(response.data.notes || []);
      } catch (error) {
        console.error('Error loading whiteboard:', error);
      }
    };

    loadWhiteboard();
  }, [whiteboardId]);

  // Handle creating new notes
  const createNote = async (x, y) => {
    try {
      const noteData = {
        content: '',
        x: x,
        y: y,
        color: '#ffeb3b'
      };

      await axios.post(`${API}/whiteboards/${whiteboardId}/notes`, noteData);
    } catch (error) {
      console.error('Error creating note:', error);
    }
  };

  // Handle updating notes
  const updateNote = async (noteId, updates) => {
    try {
      await axios.put(`${API}/whiteboards/${whiteboardId}/notes/${noteId}`, updates);
    } catch (error) {
      console.error('Error updating note:', error);
    }
  };

  // Handle deleting notes
  const deleteNote = async (noteId) => {
    try {
      await axios.delete(`${API}/whiteboards/${whiteboardId}/notes/${noteId}`);
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  };

  // Handle note dragging
  const handleNoteDrag = (noteId, position) => {
    if (socket) {
      socket.emit('note_drag', {
        whiteboard_id: whiteboardId,
        note_id: noteId,
        x: position.x,
        y: position.y
      });
    }
  };

  // DnD Kit handlers
  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragMove = (event) => {
    // Let @dnd-kit handle the visual dragging
    // Only emit real-time updates for collaboration
    const { active, delta } = event;
    if (active && delta && socket) {
      const note = notes.find(n => n.id === active.id);
      if (note) {
        const newPosition = {
          x: note.x + delta.x,
          y: note.y + delta.y
        };
        // Emit for real-time collaboration (optional)
        socket.emit('note_drag', {
          whiteboard_id: whiteboardId,
          note_id: active.id,
          x: newPosition.x,
          y: newPosition.y
        });
      }
    }
  };

  const handleDragEnd = (event) => {
    const { active, delta } = event;
    setActiveId(null);
    
    if (active && delta) {
      const note = notes.find(n => n.id === active.id);
      if (note) {
        const newPosition = {
          x: note.x + delta.x,
          y: note.y + delta.y
        };
        
        // Update local state immediately for responsive UI
        setNotes(prev => prev.map(n => 
          n.id === active.id 
            ? { ...n, x: newPosition.x, y: newPosition.y }
            : n
        ));
        
        // Update backend
        updateNote(active.id, newPosition);
      }
    }
  };

  // Handle whiteboard double-click to create new note
  const handleWhiteboardDoubleClick = (e) => {
    // Check if the click target is not a sticky note
    if (!e.target.closest('.sticky-note')) {
      const rect = whiteboardRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - viewPort.x) / viewPort.scale;
      const y = (e.clientY - rect.top - viewPort.y) / viewPort.scale;
      createNote(x, y);
    }
  };

  // Pan functionality
  const handleMouseDown = (e) => {
    if (!e.target.closest('.sticky-note')) {
      setIsPanning(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      const deltaX = e.clientX - lastPanPoint.x;
      const deltaY = e.clientY - lastPanPoint.y;
      
      setViewPort(prev => ({
        ...prev,
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      
      setLastPanPoint({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Handle zoom
  const handleWheel = (e) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setViewPort(prev => ({
      ...prev,
      scale: Math.max(0.1, Math.min(3, prev.scale * scaleFactor))
    }));
  };

  const activeNote = activeId ? notes.find(note => note.id === activeId) : null;

  return (
    <div className="w-full h-screen overflow-hidden bg-gray-100 relative">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 bg-white shadow-sm z-30 p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-semibold text-gray-800">Electronic Whiteboard</h1>
            <div className={`flex items-center space-x-2 ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">{notes.length} notes</span>
            <div className="text-sm text-gray-500">
              Double-click to add note • Drag to move • Click to edit
            </div>
          </div>
        </div>
      </div>

      {/* Whiteboard Canvas */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={whiteboardRef}
          className="absolute inset-0 pt-16 cursor-grab active:cursor-grabbing"
          style={{
            transform: `translate(${viewPort.x}px, ${viewPort.y}px) scale(${viewPort.scale})`,
            transformOrigin: '0 0'
          }}
          onDoubleClick={handleWhiteboardDoubleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        >
          {/* Grid Pattern */}
          <div className="absolute inset-0 opacity-20">
            <svg width="100%" height="100%" style={{ minWidth: '200vw', minHeight: '200vh' }}>
              <defs>
                <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>

          {/* Sticky Notes */}
          {notes.map(note => (
            <StickyNote
              key={note.id}
              note={note}
              onUpdate={updateNote}
              onDelete={deleteNote}
              onDrag={handleNoteDrag}
              isCollaborativeUpdate={note.isCollaborativeUpdate}
              isDragging={activeId === note.id}
            />
          ))}
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeNote ? (
            <StickyNote
              note={activeNote}
              onUpdate={() => {}}
              onDelete={() => {}}
              onDrag={() => {}}
              isCollaborativeUpdate={false}
              isDragging={true}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Zoom Controls */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg p-2 z-30">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setViewPort(prev => ({ ...prev, scale: Math.max(0.1, prev.scale * 0.8) }))}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            −
          </button>
          <span className="text-sm font-mono w-12 text-center">
            {Math.round(viewPort.scale * 100)}%
          </span>
          <button
            onClick={() => setViewPort(prev => ({ ...prev, scale: Math.min(3, prev.scale * 1.25) }))}
            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            +
          </button>
          <button
            onClick={() => setViewPort({ x: 0, y: 0, scale: 1 })}
            className="px-3 py-1 bg-blue-100 hover:bg-blue-200 rounded text-sm"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
};

// Main App Component
function App() {
  const [whiteboards, setWhiteboards] = useState([]);
  const [currentWhiteboardId, setCurrentWhiteboardId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWhiteboardName, setNewWhiteboardName] = useState('');

  useEffect(() => {
    loadWhiteboards();
  }, []);

  const loadWhiteboards = async () => {
    try {
      const response = await axios.get(`${API}/whiteboards`);
      const boards = response.data;
      setWhiteboards(boards);
      
      // Auto-select first whiteboard or create default one
      if (boards.length > 0) {
        setCurrentWhiteboardId(boards[0].id);
      } else {
        // Create a default whiteboard
        await createWhiteboard('My First Whiteboard');
      }
    } catch (error) {
      console.error('Error loading whiteboards:', error);
    }
  };

  const createWhiteboard = async (name) => {
    try {
      const response = await axios.post(`${API}/whiteboards`, { name });
      const newBoard = response.data;
      setWhiteboards(prev => [...prev, newBoard]);
      setCurrentWhiteboardId(newBoard.id);
      setShowCreateModal(false);
      setNewWhiteboardName('');
    } catch (error) {
      console.error('Error creating whiteboard:', error);
    }
  };

  if (!currentWhiteboardId) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading whiteboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      {/* Whiteboard Selector */}
      <div className="absolute top-4 left-4 z-40">
        <select
          value={currentWhiteboardId}
          onChange={(e) => setCurrentWhiteboardId(e.target.value)}
          className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm"
        >
          {whiteboards.map(board => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowCreateModal(true)}
          className="ml-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          + New Board
        </button>
      </div>

      {/* Create Whiteboard Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Create New Whiteboard</h3>
            <input
              type="text"
              value={newWhiteboardName}
              onChange={(e) => setNewWhiteboardName(e.target.value)}
              placeholder="Enter whiteboard name..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-4"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && newWhiteboardName.trim()) {
                  createWhiteboard(newWhiteboardName.trim());
                }
              }}
            />
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newWhiteboardName.trim()) {
                    createWhiteboard(newWhiteboardName.trim());
                  }
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={!newWhiteboardName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Whiteboard */}
      <Whiteboard whiteboardId={currentWhiteboardId} />
    </div>
  );
}

export default App;
