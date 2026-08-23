// Login Screen Logic
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // Check for existing sessions
    checkExistingSessions();
    
    // Mobile detection for admin access
    updateMobileWarning();
    window.addEventListener('resize', updateMobileWarning);
    
    // Driver login elements
    const driverSurname = document.getElementById('driverSurname');
    const driverFirstName = document.getElementById('driverFirstName');
    const plateLetters = document.getElementById('plateLetters');
    const plateNumbers = document.getElementById('plateNumbers');
    const pinInputs = document.querySelectorAll('.pin-input');
    const driverLoginBtn = document.getElementById('driverLoginBtn');
    const forgotPinLink = document.getElementById('forgotPinLink');
    
    // Admin login elements
    const adminEmail = document.getElementById('adminEmail');
    const adminPassword = document.getElementById('adminPassword');
    const togglePassword = document.getElementById('togglePassword');
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    
    // Toggle elements
    const toggleLoginType = document.getElementById('toggleLoginType');
    const driverLoginForm = document.getElementById('driverLoginForm');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const toggleText = document.getElementById('toggleText');
    
    let currentView = 'driver';
    
    // Plate number preview
    plateLetters.addEventListener('input', (e) => {
        let value = e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
        e.target.value = value;
        updatePlatePreview();
        clearError('plate');
    });
    
    plateNumbers.addEventListener('input', (e) => {
        let value = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
        e.target.value = value;
        
        // Auto-focus letters if complete
        if (value.length === 3 && plateLetters.value.length === 3) {
            pinInputs[0].focus();
        }
        
        updatePlatePreview();
        clearError('plate');
    });
    
    function updatePlatePreview() {
        const letters = plateLetters.value || '___';
        const numbers = plateNumbers.value || '____';
        const preview = document.getElementById('platePreview');
        const previewText = document.getElementById('platePreviewText');
        
        if (plateLetters.value || plateNumbers.value) {
            previewText.textContent = `${letters} ${numbers}`;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }
    }
    
    // PIN input handling
    pinInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            const value = e.target.value.replace(/[^0-9]/g, '').slice(-1);
            e.target.value = value;
            
            if (value) {
                input.classList.add('filled');
                if (index < 3) {
                    pinInputs[index + 1].focus();
                }
            } else {
                input.classList.remove('filled');
            }
            
            clearError('pin');
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') {
                if (!e.target.value && index > 0) {
                    pinInputs[index - 1].focus();
                    pinInputs[index - 1].value = '';
                    pinInputs[index - 1].classList.remove('filled');
                }
            }
        });
    });
    
    // Clear errors on input
    driverSurname.addEventListener('input', () => clearError('name'));
    driverFirstName.addEventListener('input', () => clearError('name'));
    
    // Driver login
    driverLoginBtn.addEventListener('click', handleDriverLogin);
    
    // Allow Enter key to submit
    [driverSurname, driverFirstName, plateLetters, plateNumbers].forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleDriverLogin();
        });
    });
    
    pinInputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleDriverLogin();
        });
    });
    
    async function handleDriverLogin() {
        const surname = driverSurname.value.trim();
        const firstName = driverFirstName.value.trim();
        const letters = plateLetters.value.trim();
        const numbers = plateNumbers.value.trim();
        const pin = Array.from(pinInputs).map(input => input.value).join('');
        
        // Validation
        if (!surname || !firstName) {
            showError('name', 'Please enter both your surname and first name.');
            return;
        }
        
        if (letters.length < 3 || numbers.length < 3) {
            showError('plate', 'Enter at least 3 letters and 3 numbers for the plate.');
            return;
        }
        
        if (pin.length < 4) {
            showError('pin', 'Please enter your 4-digit PIN.');
            return;
        }
        
        // Show loading
        setLoading('driver', true);
        
        try {
            const response = await apiFetch('/driver-login', {
                method: 'POST',
                body: JSON.stringify({
                    surname,
                    firstName,
                    plateLetters: letters.toUpperCase(),
                    plateNumbers: numbers,
                    pin
                })
            });
            
            // Save session
            Storage.set('360_driver_id', response.driverId);
            Storage.set('360_driver_name', response.driverName);
            
            // Redirect to driver interface
            window.location.href = 'driver.php';
            
        } catch (error) {
            const errorData = error.message;
            
            if (errorData.includes('driver_not_found')) {
                showError('name', errorData);
            } else if (errorData.includes('truck_not_found') || errorData.includes('truck_taken')) {
                showError('plate', errorData);
            } else if (errorData.includes('wrong_pin')) {
                showError('pin', errorData);
            } else {
                showError('general', errorData || 'Login failed. Please try again.');
            }
            
            setLoading('driver', false);
        }
    }
    
    // Forgot PIN
    forgotPinLink.addEventListener('click', (e) => {
        e.preventDefault();
        show('forgotPinMsg');
        setTimeout(() => hide('forgotPinMsg'), 3500);
    });
    
    // Admin password toggle
    togglePassword.addEventListener('click', () => {
        const type = adminPassword.type === 'password' ? 'text' : 'password';
        adminPassword.type = type;
        document.getElementById('eyeIcon').textContent = type === 'password' ? '👁' : '👁‍🗨';
    });
    
    // Admin login
    adminLoginBtn.addEventListener('click', handleAdminLogin);
    
    adminEmail.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAdminLogin();
    });
    
    adminPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAdminLogin();
    });
    
    adminEmail.addEventListener('input', () => clearError('admin'));
    adminPassword.addEventListener('input', () => clearError('admin'));
    
    function handleAdminLogin() {
        // Block admin access on mobile
        if (isMobile()) {
            showError('admin', 'Admin access is only available on desktop or laptop computers.');
            return;
        }
        
        const email = adminEmail.value.trim().toLowerCase();
        const password = adminPassword.value.trim();
        
        if (!email || !password) {
            showError('admin', 'Please enter your email and password.');
            return;
        }
        
        // Hardcoded accounts (as per original)
        const accounts = [
            { email: '360logistics@email.ph', password: '360Admin2026!', role: 'admin' },
            { email: 'admin360logistics@gmail.ph', password: '360Demo2026!', role: 'demo' },
            { email: 'admin360logistics@email.com', password: '360View2026!', role: 'viewer' }
        ];
        
        const account = accounts.find(a => 
            a.email.toLowerCase() === email && a.password === password
        );
        
        if (!account) {
            showError('admin', 'Invalid email or password.');
            return;
        }
        
        // Create token: base64(email:role:timestamp)
        const token = btoa(`${account.email}:${account.role}:${Date.now()}`);
        
        // Save session
        Storage.set('360_admin_token', token);
        Storage.set('360_admin_role', account.role);
        
        // Redirect to admin dashboard
        window.location.href = 'admin.php';
    }
    
    // Toggle between driver and admin login
    toggleLoginType.addEventListener('click', () => {
        if (currentView === 'driver') {
            // Switch to admin
            driverLoginForm.classList.remove('active');
            adminLoginForm.classList.add('active');
            toggleText.textContent = 'Back';
            currentView = 'admin';
            clearAllErrors();
        } else {
            // Switch to driver
            adminLoginForm.classList.remove('active');
            driverLoginForm.classList.add('active');
            toggleText.textContent = 'Admin Login';
            currentView = 'driver';
            clearAllErrors();
        }
    });
    
    // Helper functions
    function showError(type, message) {
        if (type === 'name') {
            show('nameError');
            document.getElementById('nameErrorMsg').textContent = message;
        } else if (type === 'plate') {
            show('plateError');
            document.getElementById('plateErrorMsg').textContent = message;
        } else if (type === 'pin') {
            show('pinError');
            document.getElementById('pinErrorMsg').textContent = message;
            pinInputs.forEach(input => input.classList.add('error'));
        } else if (type === 'general') {
            show('generalError');
            document.getElementById('generalErrorMsg').textContent = message;
        } else if (type === 'admin') {
            show('adminError');
            document.getElementById('adminErrorMsg').textContent = message;
        }
    }
    
    function clearError(type) {
        if (type === 'name') {
            hide('nameError');
        } else if (type === 'plate') {
            hide('plateError');
        } else if (type === 'pin') {
            hide('pinError');
            pinInputs.forEach(input => input.classList.remove('error'));
        } else if (type === 'admin') {
            hide('adminError');
        }
        hide('generalError');
    }
    
    function clearAllErrors() {
        ['nameError', 'plateError', 'pinError', 'generalError', 'adminError'].forEach(hide);
        pinInputs.forEach(input => input.classList.remove('error'));
    }
    
    function setLoading(type, loading) {
        if (type === 'driver') {
            driverLoginBtn.disabled = loading;
            if (loading) {
                hide('driverLoginText');
                show('driverLoginSpinner');
            } else {
                show('driverLoginText');
                hide('driverLoginSpinner');
            }
        } else if (type === 'admin') {
            adminLoginBtn.disabled = loading;
            if (loading) {
                hide('adminLoginText');
                show('adminLoginSpinner');
            } else {
                show('adminLoginText');
                hide('adminLoginSpinner');
            }
        }
    }
    
    function updateMobileWarning() {
        const warning = document.getElementById('mobileWarning');
        const adminBtn = document.getElementById('toggleLoginType');
        
        if (isMobile() && currentView === 'driver') {
            show(warning);
            hide(adminBtn);
        } else if (isMobile() && currentView === 'admin') {
            hide(warning);
            show(adminBtn);
        } else {
            hide(warning);
            show(adminBtn);
        }
    }
    
    function checkExistingSessions() {
        // Clear admin session on mobile
        if (isMobile()) {
            Storage.remove('360_admin_token');
            Storage.remove('360_admin_role');
        } else {
            // Check for admin session
            const adminToken = Storage.get('360_admin_token');
            const adminRole = Storage.get('360_admin_role');
            
            if (adminToken && adminRole) {
                window.location.href = 'admin.php';
                return;
            }
        }
        
        // Check for driver session
        const driverId = Storage.get('360_driver_id');
        const driverName = Storage.get('360_driver_name');
        
        if (driverId && driverName) {
            window.location.href = 'driver.php';
        }
    }
});
