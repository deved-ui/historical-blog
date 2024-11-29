const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key'; // In production, use environment variable

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// In-memory storage (replace with MongoDB in production)
const users = [{
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync('admin123', 10), // Change this in production!
    email: 'admin@example.com',
    role: 'admin',
    status: 'active',
    lastLogin: new Date().toISOString()
}];

const posts = [];
const comments = [];
const messages = [];
const mediaItems = [];

// File upload handling
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, uniqueSuffix + '-' + file.originalname)
    }
});
const upload = multer({ storage: storage });

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Auth routes
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
});

// Admin routes
app.get('/api/admin/dashboard', authenticateToken, (req, res) => {
    res.json({
        stats: {
            posts: posts.length,
            comments: comments.length,
            messages: messages.length
        },
        posts: posts.map(post => ({
            id: post.id,
            title: post.title,
            author: post.author,
            date: post.date
        })),
        comments: comments.map(comment => ({
            id: comment.id,
            post: comment.postTitle,
            author: comment.name,
            content: comment.comment,
            date: comment.date
        })),
        messages: messages.map(message => ({
            id: message.id,
            name: message.name,
            email: message.email,
            subject: message.subject,
            date: message.date
        }))
    });
});

// Post management
app.post('/api/admin/posts', authenticateToken, (req, res) => {
    const post = {
        id: posts.length + 1,
        ...req.body,
        date: new Date().toISOString()
    };
    posts.push(post);
    res.status(201).json(post);
});

app.put('/api/admin/posts/:id', authenticateToken, (req, res) => {
    const postId = parseInt(req.params.id);
    const postIndex = posts.findIndex(p => p.id === postId);

    if (postIndex === -1) {
        return res.status(404).json({ message: 'Post not found' });
    }

    posts[postIndex] = {
        ...posts[postIndex],
        ...req.body,
        id: postId
    };

    res.json(posts[postIndex]);
});

app.delete('/api/admin/posts/:id', authenticateToken, (req, res) => {
    const postId = parseInt(req.params.id);
    const postIndex = posts.findIndex(p => p.id === postId);

    if (postIndex === -1) {
        return res.status(404).json({ message: 'Post not found' });
    }

    posts.splice(postIndex, 1);
    res.status(204).send();
});

// User management routes
app.get('/api/admin/users', authenticateToken, (req, res) => {
    // Only send non-sensitive user data
    const safeUsers = users.map(({ password, ...user }) => user);
    res.json(safeUsers);
});

app.post('/api/admin/users', authenticateToken, async (req, res) => {
    const { username, email, password, role } = req.body;
    
    if (users.some(u => u.username === username)) {
        return res.status(400).json({ message: 'Username already exists' });
    }

    const newUser = {
        id: users.length + 1,
        username,
        email,
        password: await bcrypt.hash(password, 10),
        role,
        status: 'active',
        lastLogin: null
    };

    users.push(newUser);
    const { password: _, ...safeUser } = newUser;
    res.status(201).json(safeUser);
});

app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
    const userId = parseInt(req.params.id);
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found' });
    }

    const { username, email, password, role } = req.body;
    const updatedUser = {
        ...users[userIndex],
        username: username || users[userIndex].username,
        email: email || users[userIndex].email,
        role: role || users[userIndex].role
    };

    if (password) {
        updatedUser.password = await bcrypt.hash(password, 10);
    }

    users[userIndex] = updatedUser;
    const { password: _, ...safeUser } = updatedUser;
    res.json(safeUser);
});

app.delete('/api/admin/users/:id', authenticateToken, (req, res) => {
    const userId = parseInt(req.params.id);
    const userIndex = users.findIndex(u => u.id === userId);

    if (userIndex === -1) {
        return res.status(404).json({ message: 'User not found' });
    }

    if (users[userIndex].role === 'admin' && users.filter(u => u.role === 'admin').length === 1) {
        return res.status(400).json({ message: 'Cannot delete the last admin user' });
    }

    users.splice(userIndex, 1);
    res.status(204).send();
});

// Media management routes
app.get('/api/admin/media', authenticateToken, (req, res) => {
    res.json(mediaItems);
});

app.post('/api/admin/media/upload', authenticateToken, upload.array('files'), (req, res) => {
    const uploadedFiles = req.files.map(file => ({
        id: mediaItems.length + 1,
        title: file.originalname,
        url: `/uploads/${file.filename}`,
        type: file.mimetype.startsWith('image/') ? 'image' : 'document',
        size: file.size,
        date: new Date().toISOString()
    }));

    mediaItems.push(...uploadedFiles);
    res.status(201).json(uploadedFiles);
});

app.delete('/api/admin/media/:id', authenticateToken, (req, res) => {
    const mediaId = parseInt(req.params.id);
    const mediaIndex = mediaItems.findIndex(m => m.id === mediaId);

    if (mediaIndex === -1) {
        return res.status(404).json({ message: 'Media item not found' });
    }

    const media = mediaItems[mediaIndex];
    const filePath = path.join(__dirname, media.url);

    try {
        fs.unlinkSync(filePath);
        mediaItems.splice(mediaIndex, 1);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ message: 'Error deleting file' });
    }
});

// Public routes
app.get('/api/posts', (req, res) => {
    res.json(posts);
});

app.get('/api/posts/:id', (req, res) => {
    const post = posts.find(p => p.id === parseInt(req.params.id));
    if (!post) {
        return res.status(404).json({ message: 'Post not found' });
    }
    res.json(post);
});

app.post('/api/comments', (req, res) => {
    const comment = {
        id: comments.length + 1,
        ...req.body,
        date: new Date().toISOString()
    };
    comments.push(comment);
    res.status(201).json(comment);
});

app.post('/api/contact', (req, res) => {
    const message = {
        id: messages.length + 1,
        ...req.body,
        date: new Date().toISOString()
    };
    messages.push(message);
    res.status(201).json({ message: 'Message received successfully!' });
});

// Search endpoint
app.get('/api/search', (req, res) => {
    const searchTerm = req.query.q.toLowerCase();
    const searchResults = posts
        .filter(post => 
            post.title.toLowerCase().includes(searchTerm) || 
            post.content.toLowerCase().includes(searchTerm) ||
            post.tags.some(tag => tag.toLowerCase().includes(searchTerm))
        )
        .map(post => ({
            title: post.title,
            url: `/blog-post.html?id=${post.id}`,
            excerpt: post.excerpt || post.content.substring(0, 200) + '...'
        }));
    
    res.json(searchResults);
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
