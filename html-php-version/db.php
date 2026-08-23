<?php
// Database Connection and KV Store Functions
// ==============================================

require_once 'config.php';

// Database connection
function getDBConnection() {
    static $conn = null;
    
    if ($conn === null) {
        try {
            $conn = new PDO(
                "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
                DB_USER,
                DB_PASS,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
        } catch (PDOException $e) {
            die("Database connection failed: " . $e->getMessage());
        }
    }
    
    return $conn;
}

// KV Store Functions (mimics Supabase KV store)
function kvGet($key) {
    $conn = getDBConnection();
    $stmt = $conn->prepare("SELECT value FROM kv_store WHERE `key` = :key");
    $stmt->execute(['key' => $key]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if ($row) {
        return json_decode($row['value'], true);
    }
    
    return null;
}

function kvSet($key, $value) {
    $conn = getDBConnection();
    $jsonValue = json_encode($value);
    
    $stmt = $conn->prepare("
        INSERT INTO kv_store (`key`, value, updated_at) 
        VALUES (:key, :value, NOW())
        ON DUPLICATE KEY UPDATE value = :value, updated_at = NOW()
    ");
    
    $stmt->execute([
        'key' => $key,
        'value' => $jsonValue
    ]);
    
    return true;
}

function kvDelete($key) {
    $conn = getDBConnection();
    $stmt = $conn->prepare("DELETE FROM kv_store WHERE `key` = :key");
    $stmt->execute(['key' => $key]);
    return true;
}

function kvGetAll() {
    $conn = getDBConnection();
    $stmt = $conn->query("SELECT `key`, value FROM kv_store");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    $result = [];
    foreach ($rows as $row) {
        $result[$row['key']] = json_decode($row['value'], true);
    }
    
    return $result;
}

// Initialize database with default data if empty
function initializeDatabase() {
    global $INITIAL_DRIVERS, $INITIAL_TRUCKS;
    
    $drivers = kvGet('app_drivers_v1');
    if ($drivers === null) {
        kvSet('app_drivers_v1', $INITIAL_DRIVERS);
    }
    
    $trucks = kvGet('app_trucks_v1');
    if ($trucks === null) {
        kvSet('app_trucks_v1', $INITIAL_TRUCKS);
    }
    
    $assignments = kvGet('app_assignments_v1');
    if ($assignments === null) {
        kvSet('app_assignments_v1', []);
    }
    
    $completed = kvGet('app_completed_v1');
    if ($completed === null) {
        kvSet('app_completed_v1', []);
    }
    
    $cancelled = kvGet('app_cancelled_v1');
    if ($cancelled === null) {
        kvSet('app_cancelled_v1', []);
    }
    
    $notifications = kvGet('app_notifications_v1');
    if ($notifications === null) {
        kvSet('app_notifications_v1', []);
    }
}

// Strip base64 data from objects (keeps URLs, drops raw image data)
function stripBase64($obj) {
    if (is_string($obj)) {
        return (strpos($obj, 'data:') === 0) ? '[image-data-stripped]' : $obj;
    }
    
    if (is_array($obj)) {
        $result = [];
        foreach ($obj as $key => $value) {
            $result[$key] = stripBase64($value);
        }
        return $result;
    }
    
    return $obj;
}
?>
