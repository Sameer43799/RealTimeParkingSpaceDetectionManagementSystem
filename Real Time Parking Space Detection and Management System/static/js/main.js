// Global variables
let selectedSpot = null;
let parkingSpots = [];
let refreshInterval = null;
let PRICE_PER_HOUR = 220;  // Base price ₹220 per hour (updated)
let isPeakHours = false;
let isAdmin = false; // Set this based on user role

// Initialize the dashboard
function initDashboard() {
    // Initial setup
    fetchParkingSpots();
    setupEventListeners();
    initializePricing();
    
    // Set up real-time updates
    refreshInterval = setInterval(fetchParkingSpots, 5000);

    // Check if admin and show admin controls
    checkAdminStatus();
}

// Set up event listeners
function setupEventListeners() {
    $('#duration-select').on('change', updatePrice);
    $('#spot-select').on('change', handleSpotSelect);
    $('#booking-form').on('submit', handleBooking);
    $('#search-bookings').on('click', fetchUserBookings);
    $('#filter-price').on('input', filterSpotsByPrice);
    $('#toggle-peak-hours').on('change', togglePeakHours);
    
    // Set up parking map click handlers
    setupParkingMapHandlers();

    // Zoom controls
    $('#zoomIn').on('click', function() {
        const map = $('#parking-map');
        const currentScale = parseFloat(map.css('transform').split(',')[3]) || 1;
        const newScale = Math.min(currentScale * 1.2, 3); // Max zoom 3x
        map.css('transform', `scale(${newScale})`);
        updateMapScroll();
    });

    $('#zoomOut').on('click', function() {
        const map = $('#parking-map');
        const currentScale = parseFloat(map.css('transform').split(',')[3]) || 1;
        const newScale = Math.max(currentScale / 1.2, 0.5); // Min zoom 0.5x
        map.css('transform', `scale(${newScale})`);
        updateMapScroll();
    });

    $('#resetView').on('click', function() {
        $('#parking-map').css('transform', 'scale(1)');
        updateMapScroll();
    });

    // Admin mode toggle
    $('#toggleAdminMode').on('click', function() {
        isAdmin = !isAdmin;
        localStorage.setItem('isAdmin', isAdmin);
        $(this).toggleClass('btn-light btn-primary');
        if (isAdmin) {
            showAdminControls();
            showError('Admin mode activated', 'success');
        } else {
            $('.admin-controls').remove();
            showError('Admin mode deactivated', 'info');
        }
        renderParkingMap();
    });
}

// Initialize dynamic pricing
function initializePricing() {
    // Check if current time is peak hours (e.g., 9 AM - 6 PM on weekdays)
    const now = new Date();
    const hour = now.getHours();
    const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
    
    isPeakHours = isWeekday && hour >= 9 && hour < 18;
    updatePriceDisplay();
}

// Check admin status
function checkAdminStatus() {
    isAdmin = localStorage.getItem('isAdmin') === 'true';
    if (isAdmin) {
        $('#toggleAdminMode').addClass('btn-primary').removeClass('btn-light');
        showAdminControls();
    }
}

// Show admin controls
function showAdminControls() {
    if ($('.admin-controls').length) return; // Don't add if already exists
    
    const adminControls = `
        <div class="admin-controls">
            <h5><i class="fas fa-cog"></i> Admin Controls</h5>
            <div class="form-group">
                <label>Base Price per Hour</label>
                <input type="number" class="form-control" id="base-price" value="${PRICE_PER_HOUR}">
            </div>
            <div class="form-check">
                <input type="checkbox" class="form-check-input" id="toggle-peak-hours" ${isPeakHours ? 'checked' : ''}>
                <label class="form-check-label">Enable Peak Hours Pricing</label>
            </div>
            <div class="form-group">
                <label>Parking Layout</label>
                <div class="btn-group w-100">
                    <button class="btn btn-outline-primary" id="add-spot">
                        <i class="fas fa-plus"></i> Add Spot
                    </button>
                    <button class="btn btn-outline-danger" id="remove-spot">
                        <i class="fas fa-minus"></i> Remove Spot
                    </button>
                </div>
            </div>
            <button class="btn btn-primary mt-2" onclick="updateParkingConfig()">
                Save Configuration
            </button>
        </div>
    `;
    $('.col-md-4').prepend(adminControls);
    
    // Add spot placement handlers
    $('#add-spot').on('click', function() {
        $('#parking-map').addClass('spot-placement-mode');
        showError('Click on the map to add a parking spot', 'info');
    });
    
    $('#remove-spot').on('click', function() {
        $('#parking-map').addClass('spot-removal-mode');
        showError('Click on a spot to remove it', 'info');
    });
}

// Update parking configuration
function updateParkingConfig() {
    const newBasePrice = parseInt($('#base-price').val());
    if (newBasePrice && newBasePrice > 0) {
        PRICE_PER_HOUR = newBasePrice;
        updatePriceDisplay();
        showError('Parking configuration updated successfully', 'success');
    } else {
        showError('Please enter a valid base price');
    }
}

// Toggle peak hours pricing
function togglePeakHours(e) {
    isPeakHours = e.target.checked;
    updatePriceDisplay();
}

// Calculate current price based on time and demand
function calculatePrice(duration) {
    let price = PRICE_PER_HOUR * duration;
    
    // Apply peak hours surcharge (20% extra)
    if (isPeakHours) {
        price *= 1.2;
    }
    
    // Apply demand-based pricing (10% extra if less than 20% spots available)
    const availableSpots = parkingSpots.filter(spot => spot.status === 'AVAILABLE').length;
    const totalSpots = parkingSpots.length;
    if (availableSpots / totalSpots < 0.2) {
        price *= 1.1;
    }
    
    // always return a rounded integer value to avoid floating-point artifacts
    return Math.round(price);
}

// Update price display
function updatePriceDisplay() {
    const duration = parseInt($('#duration-select').val()) || 1;
    const price = calculatePrice(duration);
    // display as integer (no decimal places)
    $('#price-display').val(price.toFixed(0));
    
    // Show peak hours indicator if applicable
    const priceInfo = $('.price-info');
    if (isPeakHours) {
        if (!priceInfo.length) {
            $('#price-display').parent().after(`
                <div class="price-info">
                    <span class="peak-hours">
                        <i class="fas fa-clock"></i> Peak Hours - Higher Rates Apply
                    </span>
                </div>
            `);
        }
    } else {
        priceInfo.remove();
    }
}

// Filter spots by price
function filterSpotsByPrice() {
    const maxPrice = parseInt($('#filter-price').val());
    if (!maxPrice) return;

    $('.parking-spot').each(function() {
        const spotPrice = calculatePrice(1); // Price for 1 hour
        $(this).toggle(spotPrice <= maxPrice);
    });
}

// Set up parking map click handlers
function setupParkingMapHandlers() {
    // Right-click handler for spot availability update
    $('#parking-map').on('contextmenu', '.parking-spot', function(e) {
        e.preventDefault();
        if (!isAdmin) return;
        
        const spotId = $(this).data('spot-id');
        const spot = parkingSpots.find(s => s.id === spotId);
        if (spot) {
            updateSpotAvailability(spotId, spot.status);
        }
    });

    // Left-click handler for spot selection
    $('#parking-map').on('click', '.parking-spot', function(e) {
        const spotId = $(this).data('spot-id');
        const spot = parkingSpots.find(s => s.id === spotId);
        
        if (spot && spot.status === 'AVAILABLE') {
            selectSpot(spotId);
        }
    });
}

// Render the parking map
function renderParkingMap() {
    const mapContainer = $('#parking-map');
    mapContainer.empty();

    // Add instructions
    const instruction = $('<div>')
        .addClass('map-instruction')
        .html(`
            <div><i class="fas fa-info-circle"></i> Click an available spot to select it for booking</div>
            ${isAdmin ? '<div><i class="fas fa-right-click"></i> Right-click to toggle spot availability (Admin only)</div>' : ''}
            <div><i class="fas fa-clock"></i> ${isPeakHours ? 'Peak hours pricing in effect' : 'Normal hours pricing'}</div>
        `);
    mapContainer.append(instruction);

    // Render parking spots
    parkingSpots.forEach(spot => {
        const price = calculatePrice(1);
        const spotElement = $('<div>')
            .addClass('parking-spot')
            .addClass(spot.status.toLowerCase())
            .attr('data-spot-id', spot.id)
            .html(`
                <div class="spot-content">
                    <div class="spot-id">${spot.id}</div>
                    ${spot.status === 'AVAILABLE' ? 
                        `<div class="spot-price">₹${price}/hr</div>` : 
                        `<div class="spot-status">${spot.status}</div>`
                    }
                </div>
                <div class="tooltip-content">
                    <strong>Spot ${spot.id}</strong><br>
                    Status: ${spot.status}<br>
                    ${spot.status === 'AVAILABLE' ? `Price: ₹${price}/hr<br>` : ''}
                    ${isPeakHours ? '<span class="peak-hours">Peak Hours</span>' : ''}
                </div>
            `)
            .css({
                left: spot.position.x + 'px',
                top: spot.position.y + 'px'
            });

        if (selectedSpot === spot.id) {
            spotElement.addClass('selected');
        }

        mapContainer.append(spotElement);
    });

    updateStatusInfo();
    updateMapScroll();
}

// Update spot availability
function updateSpotAvailability(spotId, currentStatus) {
    const newStatus = currentStatus === 'AVAILABLE' ? 'OCCUPIED' : 'AVAILABLE';
    const confirmMsg = `Do you want to mark spot ${spotId} as ${newStatus.toLowerCase()}?`;
    
    if (confirm(confirmMsg)) {
        $.ajax({
            url: `/api/update-spot-availability/${spotId}`,
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ status: newStatus }),
            success: function(response) {
                showError(response.message, 'success');
                fetchParkingSpots();
            },
            error: function(xhr) {
                const error = xhr.responseJSON?.error || 'Failed to update spot availability';
                showError(error);
            }
        });
    }
}

// Handle booking form submission
function handleBooking(event) {
    event.preventDefault();

    const formData = {
        name: $('#name').val(),
        vehicle_number: $('#vehicle-number').val().toUpperCase(),
        contact_number: $('#contact-number').val(),
        slot_id: $('#spot-select').val(),
        duration_hours: parseInt($('#duration-select').val())
    };

    if (!validateForm(formData)) return;

    // Show booking confirmation modal first
    showBookingConfirmation({
        ...formData,
        amount: calculatePrice(formData.duration_hours),
        isPeakHours
    }, () => {
        // Callback after user confirms
        submitBooking(formData);
    });
}

// Show booking confirmation before submitting
function showBookingConfirmation(data, onConfirm) {
    const details = `
        <div class="booking-details">
            <p><strong>Name:</strong> ${data.name}</p>
            <p><strong>Vehicle Number:</strong> ${data.vehicle_number}</p>
            <p><strong>Spot Number:</strong> ${data.slot_id}</p>
            <p><strong>Duration:</strong> ${data.duration_hours} hours</p>
            <p><strong>Amount:</strong> ₹${data.amount.toFixed(2)}</p>
            ${data.isPeakHours ? '<p class="peak-hours">Peak Hours Pricing Applied</p>' : ''}
        </div>
    `;

    // Create a new modal for confirmation
    const modal = $(`
        <div class="modal fade" id="confirmBookingModal">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Confirm Booking</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        ${details}
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="confirmBooking">Confirm Booking</button>
                    </div>
                </div>
            </div>
        </div>
    `);

    // Add to document and show
    $('body').append(modal);
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();

    // Handle confirmation
    $('#confirmBooking').on('click', function() {
        modalInstance.hide();
        modal.remove();
        onConfirm();
    });

    // Clean up on hide
    modal.on('hidden.bs.modal', function() {
        modal.remove();
    });
}

// Submit booking to server
function submitBooking(formData) {
    $.ajax({
        url: '/api/book-spot',
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(formData),
        success: function(response) {
            showBookingSuccess(response);
            fetchParkingSpots();
            $('#booking-form')[0].reset();
            selectedSpot = null;
        },
        error: function(xhr) {
            const error = xhr.responseJSON?.error || 'Failed to book the spot. Please try again.';
            showError(error);
        }
    });
}

// Show successful booking
function showBookingSuccess(booking) {
    const details = `
        <div class="booking-details">
            <p><strong>Booking ID:</strong> ${booking.id}</p>
            <p><strong>Name:</strong> ${booking.name}</p>
            <p><strong>Vehicle Number:</strong> ${booking.vehicle_number}</p>
            <p><strong>Spot Number:</strong> ${booking.slot_id}</p>
            <p><strong>Duration:</strong> ${booking.duration_hours} hours</p>
            <p><strong>Amount:</strong> ₹${booking.amount}</p>
            <p><strong>Start Time:</strong> ${new Date(booking.start_time).toLocaleString()}</p>
            <p><strong>End Time:</strong> ${new Date(booking.end_time).toLocaleString()}</p>
            ${isPeakHours ? '<p class="peak-hours">Peak Hours Pricing Applied</p>' : ''}
        </div>
    `;
    $('#booking-details').html(details);
    $('#bookingModal').modal('show');
}

// Sync parking positions from CarParkPos file with database
function syncParkingPositions() {
    return $.ajax({
        url: '/api/sync-parking-positions',
        method: 'POST',
        success: function(response) {
            if (response.status === 'success') {
                console.log('Parking positions synced:', response.message);
            }
        },
        error: function(xhr) {
            // Silently fail - the get_parking_spots will handle initialization
            console.log('Sync not needed or failed, using existing database');
        }
    });
}

// Fetch parking spots from the server
function fetchParkingSpots() {
    // First sync positions from CarParkPos file, then fetch spots
    $.when(syncParkingPositions()).then(function() {
        $.ajax({
            url: '/api/parking-spots',
            method: 'GET',
            success: function(response) {
                parkingSpots = response.spots;
                renderParkingMap();
                updateSpotSelect();
                updateStatusInfo(response.available_spots, response.total_spots);
            },
            error: function(xhr) {
                showError('Failed to fetch parking spots. Please try again.');
            }
        });
    });
}

// Update status information
function updateStatusInfo() {
    const availableSpots = parkingSpots.filter(spot => spot.status === 'AVAILABLE').length;
    $('#available-spots span').text(availableSpots);
    $('#total-spots span').text(parkingSpots.length);
}

// Handle spot selection
function selectSpot(spotId) {
    const spot = parkingSpots.find(s => s.id === spotId);
    if (!spot || spot.status !== 'AVAILABLE') {
        showError('This spot is not available for booking.');
        return;
    }

    selectedSpot = spotId;
    $('#spot-select').val(spotId);
    renderParkingMap();
    updatePrice();
}

// Handle spot select change
function handleSpotSelect() {
    const spotId = $(this).val();
    if (spotId) {
        selectSpot(spotId);
    } else {
        selectedSpot = null;
        renderParkingMap();
        updatePrice();
    }
}

// Update the spot selection dropdown
function updateSpotSelect() {
    const select = $('#spot-select');
    select.empty();
    select.append('<option value="">Choose a spot...</option>');

    const availableSpots = parkingSpots.filter(spot => spot.status === 'AVAILABLE');
    availableSpots.forEach(spot => {
        select.append(`<option value="${spot.id}">Spot ${spot.id} - ₹${PRICE_PER_HOUR}</option>`);
    });

    if (selectedSpot) {
        select.val(selectedSpot);
    }
}

// Calculate and update the price display
function updatePrice() {
    const duration = parseInt($('#duration-select').val());
    if (!duration) {
        $('#price-display').val('');
        return;
    }
    let totalPrice = PRICE_PER_HOUR * duration;
    totalPrice = Math.round(totalPrice);
    $('#price-display').val(totalPrice.toFixed(0));
}

// Validate form data
function validateForm(formData) {
    const vehicleNumberPattern = /^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$/;
    const contactNumberPattern = /^\d{10}$/;

    if (!formData.name.trim()) {
        showError('Please enter your full name.');
        return false;
    }

    if (!vehicleNumberPattern.test(formData.vehicle_number.toUpperCase())) {
        showError('Please enter a valid vehicle number (e.g., MH12AB1234).');
        return false;
    }

    if (!contactNumberPattern.test(formData.contact_number)) {
        showError('Please enter a valid 10-digit contact number.');
        return false;
    }

    if (!formData.slot_id) {
        showError('Please select a parking spot.');
        return false;
    }

    return true;
}

// Fetch user bookings
function fetchUserBookings() {
    const contactNumber = $('#search-contact').val();
    if (!contactNumber) {
        showError('Please enter a contact number to search bookings.');
        return;
    }

    if (!/^\d{10}$/.test(contactNumber)) {
        showError('Please enter a valid 10-digit contact number.');
        return;
    }

    $.ajax({
        url: `/api/user-bookings/${contactNumber}`,
        method: 'GET',
        success: function(response) {
            displayBookings(response.bookings);
        },
        error: function(xhr) {
            const error = xhr.responseJSON?.error || 'Failed to fetch bookings. Please try again.';
            showError(error);
        }
    });
}

// Display bookings in the table
function displayBookings(bookings) {
    if (!bookings || bookings.length === 0) {
        $('#bookings-list').html('<p class="text-center">No bookings found.</p>');
        return;
    }

    const table = `
        <table class="table table-striped">
            <thead>
                <tr>
                    <th>Booking ID</th>
                    <th>Name</th>
                    <th>Vehicle Number</th>
                    <th>Spot</th>
                    <th>Duration</th>
                    <th>Amount</th>
                    <th>Start Time</th>
                    <th>Status</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${bookings.map(booking => `
                    <tr>
                        <td>${booking.id}</td>
                        <td>${booking.name}</td>
                        <td>${booking.vehicle_number}</td>
                        <td>${booking.slot_id}</td>
                        <td>${booking.duration_hours} hours</td>
                        <td>₹${booking.amount}</td>
                        <td>${new Date(booking.start_time).toLocaleString()}</td>
                        <td>${booking.status}</td>
                        <td>
                            ${booking.status === 'ACTIVE' ? `
                                <button class="btn btn-sm btn-danger" onclick="cancelBooking(${booking.id})">
                                    Cancel
                                </button>
                            ` : '-'}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    $('#bookings-list').html(table);
}

// Cancel booking
function cancelBooking(bookingId) {
    if (!confirm('Are you sure you want to cancel this booking?')) {
        return;
    }

    $.ajax({
        url: `/api/cancel-booking/${bookingId}`,
        method: 'POST',
        success: function(response) {
            showError('Booking cancelled successfully.', 'success');
            const contactNumber = $('#search-contact').val();
            if (contactNumber) {
                fetchUserBookings();
            }
            fetchParkingSpots();
        },
        error: function(xhr) {
            const error = xhr.responseJSON?.error || 'Failed to cancel booking. Please try again.';
            showError(error);
        }
    });
}

// Show error message
function showError(message, type = 'danger') {
    const errorDiv = $('#error-message');
    errorDiv.removeClass('alert-danger alert-success').addClass(`alert-${type}`);
    errorDiv.text(message);
    errorDiv.fadeIn();
    setTimeout(() => errorDiv.fadeOut(), 5000);
}

// Update map scroll position
function updateMapScroll() {
    const container = $('#parking-map-container');
    const map = $('#parking-map');
    const containerWidth = container.width();
    const containerHeight = container.height();
    const mapWidth = map.width();
    const mapHeight = map.height();
    
    container.scrollLeft((mapWidth - containerWidth) / 2);
    container.scrollTop((mapHeight - containerHeight) / 2);
}

// Initialize when document is ready
$(document).ready(initDashboard); 