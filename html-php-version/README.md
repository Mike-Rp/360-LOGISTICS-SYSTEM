# 360 Logistics - HTML/CSS/JavaScript/PHP Version

Complete conversion of the React/TypeScript/Supabase application to plain HTML, CSS, JavaScript, and PHP.

## 📋 Features

- **Two Role-Based Interfaces**:
  - **Admin Dashboard** (Desktop-only): Full management system with KPIs, charts, driver management, delivery tracking, document approval, and reports
  - **Driver Interface** (Mobile-first): Task management, status updates, photo uploads, and document submissions

- **Authentication**:
  - Admin: Email/password with 3 hardcoded accounts (admin, demo, viewer)
  - Driver: Name + Truck Plate + 4-digit PIN validation
  - Frontend validation with PHP backend verification
  - Session persistence via localStorage
  - Mobile detection to block admin access on phones/tablets

- **Real-time Sync**:
  - Driver side polls every 5 seconds
  - Admin side polls every 12 seconds
  - Auto-save every 1.5 seconds

- **Document Management**:
  - Image upload with client-side compression (600px max, JPEG 65%)
  - Admin approval/rejection workflow
  - Smart document merge to preserve approval status

- **Data Persistence**:
  - MySQL database with KV store pattern
  - All data stored as JSON in key-value pairs
  - Mimics Supabase KV store functionality

## 🚀 Installation

### Requirements

- **PHP 7.4+** (with PDO MySQL extension)
- **MySQL 5.7+** or **MariaDB 10.2+**
- **Apache** or **Nginx** web server
- Modern web browser

### Step 1: Database Setup

1. Create a MySQL database:
```sql
CREATE DATABASE 360_logistics CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

2. Import the database schema:
```bash
mysql -u root -p 360_logistics < setup.sql
```

Or manually run the SQL commands in `setup.sql`.

3. Update database credentials in `config.php`:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', '360_logistics');
define('DB_USER', 'your_username');
define('DB_PASS', 'your_password');
```

### Step 2: File Permissions

Ensure the `uploads/` directory is writable:
```bash
chmod 755 uploads/
```

### Step 3: Web Server Configuration

#### Apache (.htaccess)

Create `.htaccess` in the root directory:
```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /
    
    # API endpoint rewrite
    RewriteRule ^api/(.*)$ api.php/$1 [QSA,L]
    
    # Block direct access to config and db files
    RewriteRule ^(config|db)\.php$ - [F,L]
</IfModule>
```

#### Nginx

Add to your nginx configuration:
```nginx
location / {
    try_files $uri $uri/ /index.php?$query_string;
}

location ~ ^/api/(.*)$ {
    fastcgi_pass unix:/var/run/php/php7.4-fpm.sock;
    fastcgi_param SCRIPT_FILENAME $document_root/api.php;
    include fastcgi_params;
}

location ~ ^/(config|db)\.php$ {
    deny all;
}
```

### Step 4: Access the Application

Open your browser and navigate to:
```
http://localhost/360-logistics/
```

Or your configured domain/path.

## 👥 Login Credentials

### Admin Accounts

1. **Full Admin** (Full access + auto-save):
   - Email: `360logistics@email.ph`
   - Password: `360Admin2026!`

2. **Demo Account** (Full access + demo panel):
   - Email: `admin360logistics@gmail.ph`
   - Password: `360Demo2026!`

3. **View-Only** (Read-only access):
   - Email: `admin360logistics@email.com`
   - Password: `360View2026!`

### Driver Accounts

Default drivers (use any truck plate from the system):

1. **Hanna Belarmino**
   - Name: Hanna Belarmino
   - PIN: `3812`

2. **Kian Yamzon**
   - Name: Kian Yamzon
   - PIN: `5047`

3. **Kevin Villaver**
   - Name: Kevin Villaver
   - PIN: `7293`

4. **Mikhail Respicio**
   - Name: Mikhail Respicio
   - PIN: `6154`

**Available Truck Plates**:
- ABC 1234
- DEF 5678
- GHI 9012
- JKL 3456
- MNO 7890
- PQR 2345
- STU 6789

## 📁 File Structure

```
360-logistics/
├── index.php                 # Login page
├── admin.php                 # Admin dashboard
├── driver.php                # Driver interface
├── api.php                   # All API endpoints
├── config.php                # Configuration
├── db.php                    # Database functions
├── setup.sql                 # Database schema
├── .htaccess                 # Apache rewrite rules
├── assets/
│   ├── css/
│   │   └── style.css        # All styles
│   ├── js/
│   │   ├── common.js        # Shared utilities
│   │   ├── login.js         # Login logic
│   │   ├── admin.js         # Admin dashboard logic
│   │   └── driver.js        # Driver interface logic
│   └── images/
│       └── logo.png         # Company logo
└── uploads/                  # Image uploads directory
```

## 🔌 API Endpoints

All endpoints are in `api.php`:

### Authentication
- `POST /driver-login` - Driver authentication
- Admin auth is frontend-only (no API endpoint)

### Admin Operations
- `GET /app-data` - Get all application data
- `PUT /app-data` - Save application data (auto-save)

### Driver Operations
- `GET /driver-data?driverId={id}` - Get driver's assignment
- `PUT /driver-update` - Update assignment status/photos/documents

### Utilities
- `POST /upload-image` - Upload and store images
- `GET /health` - Health check

## 🔐 Security Notes

⚠️ **Important**: This is a **demonstration/capstone project** with simplified security:

1. **Admin authentication is frontend-only** - Credentials are hardcoded in both `config.php` and login JavaScript
2. **Tokens are simple base64** - Not cryptographically secure (use JWT in production)
3. **No password hashing** - Passwords stored in plain text in config
4. **No CSRF protection** - Should be added for production
5. **No rate limiting** - Should be added to prevent brute force

**For Production Use**, you MUST:
- Implement proper password hashing (bcrypt/argon2)
- Use secure session management
- Add CSRF tokens
- Implement rate limiting
- Use HTTPS only
- Validate and sanitize all inputs
- Add proper error logging
- Implement SQL injection prevention (currently using PDO prepared statements ✓)

## 🛠️ Customization

### Adding New Admin Accounts

Edit `config.php`:
```php
$ADMIN_ACCOUNTS = [
    [
        'email' => 'newadmin@example.com',
        'password' => 'SecurePassword123!',
        'role' => 'admin'  // or 'demo' or 'viewer'
    ],
    // ... existing accounts
];
```

Also update `assets/js/login.js` to match.

### Adding New Drivers

Via the Admin Dashboard:
1. Login as admin
2. Go to "Accounts" section
3. Click "Add Driver"
4. Fill in details including PIN

Or directly in database via `app_drivers_v1` key.

### Changing Polling Intervals

In `assets/js/admin.js`:
```javascript
const ADMIN_POLL_INTERVAL = 12000; // milliseconds
const AUTO_SAVE_INTERVAL = 1500;
```

In `assets/js/driver.js`:
```javascript
const DRIVER_POLL_INTERVAL = 5000; // milliseconds
```

## 🐛 Troubleshooting

### Database Connection Error
- Verify MySQL is running
- Check credentials in `config.php`
- Ensure database exists and schema is imported

### Upload Directory Error
- Check `uploads/` directory exists
- Verify write permissions (755 or 777)
- Check PHP `upload_max_filesize` and `post_max_size`

### Session Not Persisting
- Check browser localStorage is enabled
- Clear browser cache and cookies
- Verify JavaScript is enabled

### Mobile Admin Access Blocked
- This is intentional - admin access is desktop-only
- Use a desktop/laptop with screen width ≥768px
- Or modify `isMobile()` function in `common.js`

## 📝 Differences from React Version

### Removed Features
- React/TypeScript framework
- Supabase Auth (replaced with simple token auth)
- Supabase Edge Functions/Deno (replaced with PHP)
- Recharts (would need to add Chart.js or similar)
- React Router (using simple multi-page PHP)

### Modified Features
- State management: React state → vanilla JS variables
- Data flow: React props → localStorage + API polling
- Routing: React Router → PHP pages
- Storage: Supabase Storage → local file uploads
- Real-time: Supabase realtime → polling

### Added Features
- Simple MySQL database with KV store pattern
- PHP session management
- Direct file uploads to server
- Simplified token authentication

## 📄 License

This is a capstone/demonstration project. Modify as needed for your use case.

## 🤝 Support

For issues or questions, please check:
1. Database connection and credentials
2. File permissions
3. PHP error logs
4. Browser console for JavaScript errors

---

**Note**: This application is designed for demonstration and educational purposes. For production deployment, implement proper security measures as outlined in the Security Notes section.
