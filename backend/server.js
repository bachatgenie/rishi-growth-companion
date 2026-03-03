const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Data directory
const DATA_DIR = path.join(__dirname, '../data');
const CONFIG_FILE = path.join(__dirname, '../config/app.json');

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (e) {
        console.error('Error creating data directory:', e);
    }
}

// Load config
async function loadConfig() {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
}

// Save data
async function saveData(filename, data) {
    const filepath = path.join(DATA_DIR, filename);
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
}

// Load data
async function loadData(filename, defaultData = {}) {
    try {
        const filepath = path.join(DATA_DIR, filename);
        const data = await fs.readFile(filepath, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return defaultData;
    }
}

// ============ AUTH ROUTES ============

// Child login (PIN)
app.post('/api/auth/child', async (req, res) => {
    const { pin } = req.body;
    const config = await loadConfig();
    
    if (pin === config.auth.child.pin) {
        res.json({
            success: true,
            role: 'child',
            name: config.childName,
            nameMr: config.childNameMarathi
        });
    } else {
        res.status(401).json({ success: false, error: 'Invalid PIN' });
    }
});

// Parent login (Password)
app.post('/api/auth/parent', async (req, res) => {
    const { password } = req.body;
    const config = await loadConfig();
    
    if (password === config.auth.parent.password) {
        res.json({
            success: true,
            role: 'parent',
            name: config.parentName,
            nameMr: config.parentNameMarathi
        });
    } else {
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

// ============ CONFIG ROUTES ============

// Get app config (public)
app.get('/api/config', async (req, res) => {
    const config = await loadConfig();
    // Remove sensitive auth data
    const publicConfig = {
        appName: config.appName,
        appNameMarathi: config.appNameMarathi,
        childName: config.childName,
        childNameMarathi: config.childNameMarathi,
        parentName: config.parentName,
        parentNameMarathi: config.parentNameMarathi,
        tasks: config.tasks,
        goodBehaviors: config.goodBehaviors,
        badBehaviors: config.badBehaviors,
        rewards: config.rewards,
        games: config.games
    };
    res.json(publicConfig);
});

// Update config (parent only)
app.post('/api/config', async (req, res) => {
    // In production, add parent auth middleware
    const config = await loadConfig();
    const updated = { ...config, ...req.body };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(updated, null, 2));
    res.json({ success: true });
});

// ============ PROGRESS ROUTES ============

// Get today's progress
app.get('/api/progress/today', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const progress = await loadData(`progress-${today}.json`, {
        date: today,
        tasksCompleted: [],
        behaviors: [],
        totalPoints: 0,
        gameTimeEarned: 0,
        gameTimeUsed: 0
    });
    res.json(progress);
});

// Complete task
app.post('/api/progress/task', async (req, res) => {
    const { taskId, verifiedBy } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const config = await loadConfig();
    
    let progress = await loadData(`progress-${today}.json`, {
        date: today,
        tasksCompleted: [],
        behaviors: [],
        totalPoints: 0,
        gameTimeEarned: 0,
        gameTimeUsed: 0
    });
    
    const task = config.tasks.find(t => t.id === taskId);
    if (!task) {
        return res.status(404).json({ error: 'Task not found' });
    }
    
    // Check if already completed
    if (progress.tasksCompleted.find(t => t.taskId === taskId)) {
        return res.status(400).json({ error: 'Task already completed today' });
    }
    
    progress.tasksCompleted.push({
        taskId,
        completedAt: new Date().toISOString(),
        verifiedBy,
        points: task.points,
        gameTime: task.gameTimeReward
    });
    
    progress.totalPoints += task.points;
    progress.gameTimeEarned += task.gameTimeReward;
    
    await saveData(`progress-${today}.json`, progress);
    res.json({ success: true, progress });
});

// Add behavior (good or bad)
app.post('/api/progress/behavior', async (req, res) => {
    const { behaviorId, type, notes } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const config = await loadConfig();
    
    let progress = await loadData(`progress-${today}.json`, {
        date: today,
        tasksCompleted: [],
        behaviors: [],
        totalPoints: 0,
        gameTimeEarned: 0,
        gameTimeUsed: 0
    });
    
    const behaviorList = type === 'good' ? config.goodBehaviors : config.badBehaviors;
    const behavior = behaviorList.find(b => b.id === behaviorId);
    
    if (!behavior) {
        return res.status(404).json({ error: 'Behavior not found' });
    }
    
    progress.behaviors.push({
        behaviorId,
        type,
        points: behavior.points,
        notes,
        recordedAt: new Date().toISOString()
    });
    
    progress.totalPoints += behavior.points;
    
    await saveData(`progress-${today}.json`, progress);
    res.json({ success: true, progress });
});

// Use game time
app.post('/api/progress/use-game-time', async (req, res) => {
    const { minutes } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    let progress = await loadData(`progress-${today}.json`, {
        date: today,
        tasksCompleted: [],
        behaviors: [],
        totalPoints: 0,
        gameTimeEarned: 0,
        gameTimeUsed: 0
    });
    
    const available = progress.gameTimeEarned - progress.gameTimeUsed;
    
    if (minutes > available) {
        return res.status(400).json({ 
            error: 'Not enough game time',
            available,
            requested: minutes
        });
    }
    
    progress.gameTimeUsed += minutes;
    await saveData(`progress-${today}.json`, progress);
    
    res.json({ 
        success: true, 
        used: minutes,
        remaining: progress.gameTimeEarned - progress.gameTimeUsed
    });
});

// ============ STATS ROUTES ============

// Get lifetime stats
app.get('/api/stats/lifetime', async (req, res) => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const progressFiles = files.filter(f => f.startsWith('progress-'));
        
        let totalPoints = 0;
        let totalTasks = 0;
        let totalBehaviors = 0;
        let currentStreak = 0;
        let bestStreak = 0;
        let lastDate = null;
        
        const dailyStats = [];
        
        for (const file of progressFiles.sort()) {
            const data = await loadData(file);
            totalPoints += data.totalPoints || 0;
            totalTasks += data.tasksCompleted?.length || 0;
            totalBehaviors += data.behaviors?.length || 0;
            
            dailyStats.push({
                date: data.date,
                points: data.totalPoints || 0,
                tasks: data.tasksCompleted?.length || 0
            });
            
            // Calculate streak
            const date = new Date(data.date);
            if (lastDate) {
                const diff = (lastDate - date) / (1000 * 60 * 60 * 24);
                if (diff === 1 && data.totalPoints > 0) {
                    currentStreak++;
                } else if (data.totalPoints > 0) {
                    currentStreak = 1;
                }
            } else if (data.totalPoints > 0) {
                currentStreak = 1;
            }
            
            bestStreak = Math.max(bestStreak, currentStreak);
            lastDate = date;
        }
        
        // Calculate ELO (simplified)
        const elo = Math.min(3000, Math.max(100, 400 + totalPoints * 2));
        
        res.json({
            totalPoints,
            totalTasks,
            totalBehaviors,
            currentStreak,
            bestStreak,
            elo,
            rank: getRank(elo),
            dailyStats: dailyStats.slice(-30) // Last 30 days
        });
    } catch (e) {
        res.json({
            totalPoints: 0,
            totalTasks: 0,
            totalBehaviors: 0,
            currentStreak: 0,
            bestStreak: 0,
            elo: 400,
            rank: 'Beginner',
            dailyStats: []
        });
    }
});

function getRank(elo) {
    if (elo >= 2400) return 'Grandmaster';
    if (elo >= 2000) return 'Master';
    if (elo >= 1600) return 'Expert';
    if (elo >= 1200) return 'Advanced';
    if (elo >= 800) return 'Intermediate';
    return 'Beginner';
}

// ============ MESSAGES ROUTES ============

// Get messages
app.get('/api/messages', async (req, res) => {
    const messages = await loadData('messages.json', { messages: [] });
    res.json(messages.messages.slice(-50)); // Last 50 messages
});

// Send message
app.post('/api/messages', async (req, res) => {
    const { from, text, textMr } = req.body;
    
    let data = await loadData('messages.json', { messages: [] });
    
    data.messages.push({
        id: Date.now(),
        from,
        text,
        textMr,
        timestamp: new Date().toISOString(),
        read: false
    });
    
    await saveData('messages.json', data);
    res.json({ success: true });
});

// ============ START SERVER ============

ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log(`Rishi's Growth Companion API running on port ${PORT}`);
        console.log(`Child login: http://localhost:${PORT}/child`);
        console.log(`Parent login: http://localhost:${PORT}/parent`);
    });
});
