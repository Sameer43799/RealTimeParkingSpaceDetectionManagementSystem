from flask import Flask, render_template, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime, timezone
import cv2
import numpy as np
import pickle
import os
import logging
import re

def admin_dashboard():
    return render_template('admin_dashboard.html')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///parking.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Constants
PRICE_PER_HOUR = 220  # Fixed price in INR per hour
PARKING_VIDEO_PATH = 'carPark.mp4'
PARKING_POSITIONS_FILE = 'CarParkPos'

# Database Models
class ParkingSlot(db.Model):
    __tablename__ = 'parking_slot'
    id = db.Column(db.String(10), primary_key=True)
    status = db.Column(db.String(20), default='AVAILABLE')
    position_x = db.Column(db.Integer)
    position_y = db.Column(db.Integer)
    bookings = db.relationship('Booking', backref='parking_slot', lazy=True)

class Booking(db.Model):
    __tablename__ = 'booking'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    vehicle_number = db.Column(db.String(20), nullable=False)
    contact_number = db.Column(db.String(15), nullable=False)
    slot_id = db.Column(db.String(10), db.ForeignKey('parking_slot.id'), nullable=False)
    booking_time = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime, nullable=False)
    duration_hours = db.Column(db.Integer, nullable=False)
    amount = db.Column(db.Float, nullable=False)
    payment_mode = db.Column(db.String(20), default='Cash')
    status = db.Column(db.String(20), default='ACTIVE')

def validate_vehicle_number(vehicle_number):
    # Format: MH12AB1234 or similar
    pattern = r'^[A-Z]{2}\d{2}[A-Z]{2}\d{4}$'
    return bool(re.match(pattern, vehicle_number))

def validate_contact_number(contact_number):
    # 10-digit number
    pattern = r'^\d{10}$'
    return bool(re.match(pattern, contact_number))

def process_video_frame():
    try:
        # Try both video files
        video_files = ['carPark.mp4', 'park.mp4']
        cap = None
        
        for video_file in video_files:
            if os.path.exists(video_file):
                cap = cv2.VideoCapture(video_file)
                if cap.isOpened():
                    logger.info(f"Successfully opened video file: {video_file}")
                    break
                else:
                    cap.release()
                    logger.warning(f"Failed to open video file: {video_file}")
        
        if cap is None:
            logger.error("No valid video file found")
            return None
            
        success, img = cap.read()
        if not success:
            logger.error("Failed to read video frame")
            cap.release()
            return None
            
        # Process the image
        imgGray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        imgBlur = cv2.GaussianBlur(imgGray, (3, 3), 1)
        imgThreshold = cv2.adaptiveThreshold(imgBlur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                         cv2.THRESH_BINARY_INV, 25, 16)
        imgMedian = cv2.medianBlur(imgThreshold, 5)
        kernel = np.ones((3, 3), np.uint8)
        imgDilate = cv2.dilate(imgMedian, kernel, iterations=1)
        
        cap.release()
        return imgDilate
    except Exception as e:
        logger.error(f"Error processing video frame: {e}")
        if 'cap' in locals() and cap is not None:
            cap.release()
        return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/parking-spots', methods=['GET'])
def get_parking_spots():
    try:
        # Load parking spots from database
        slots = ParkingSlot.query.all()
        
        # Initialize parking spots if database is empty
        if not slots:
            try:
                with open(PARKING_POSITIONS_FILE, 'rb') as f:
                    posList = pickle.load(f)
                    for idx, pos in enumerate(posList):
                        slot = ParkingSlot(
                            id=f'P{idx+1}',
                            position_x=pos[0],
                            position_y=pos[1]
                        )
                        db.session.add(slot)
                    db.session.commit()
                    slots = ParkingSlot.query.all()
            except Exception as e:
                logger.error(f"Error loading parking positions: {e}")
                return jsonify({'error': 'Failed to initialize parking spots'}), 500

        # Process video frame for occupancy detection
        imgDilate = process_video_frame()
        
        spots_data = []
        current_time = datetime.now(timezone.utc)
        
        for slot in slots:
            # Check current bookings
            active_booking = Booking.query.filter_by(
                slot_id=slot.id,
                status='ACTIVE'
            ).filter(
                Booking.start_time <= current_time,
                Booking.end_time >= current_time
            ).first()

            if active_booking:
                status = 'OCCUPIED'
            elif imgDilate is not None:
                # Check physical occupancy using video frame
                x, y = slot.position_x, slot.position_y
                try:
                    imgCrop = imgDilate[y:y + 48, x:x + 107]
                    count = cv2.countNonZero(imgCrop)
                    status = 'OCCUPIED' if count > 900 else 'AVAILABLE'
                except Exception as e:
                    logger.error(f"Error processing spot {slot.id}: {e}")
                    status = slot.status
            else:
                status = slot.status

            spots_data.append({
                'id': slot.id,
                'status': status,
                'position': {
                    'x': slot.position_x,
                    'y': slot.position_y
                },
                'price': PRICE_PER_HOUR
            })

        return jsonify({
            'spots': spots_data,
            'total_spots': len(spots_data),
            'available_spots': sum(1 for spot in spots_data if spot['status'] == 'AVAILABLE')
        })

    except Exception as e:
        logger.error(f"Error in get_parking_spots: {e}")
        return jsonify({'error': 'Failed to fetch parking spots'}), 500

@app.route('/api/book-spot', methods=['POST'])
def book_spot():
    try:
        data = request.json
        
        # Validate input data
        if not all([data.get('name'), data.get('vehicle_number'), 
                   data.get('contact_number'), data.get('slot_id'),
                   data.get('duration_hours')]):
            return jsonify({'error': 'Missing required fields'}), 400

        if not validate_vehicle_number(data['vehicle_number']):
            return jsonify({'error': 'Invalid vehicle number format'}), 400

        if not validate_contact_number(data['contact_number']):
            return jsonify({'error': 'Invalid contact number'}), 400

        slot = ParkingSlot.query.get(data['slot_id'])
        if not slot:
            return jsonify({'error': 'Invalid parking slot'}), 400

        # Check if slot is available
        current_time = datetime.utcnow()
        active_booking = Booking.query.filter_by(
            slot_id=data['slot_id'],
            status='ACTIVE'
        ).filter(
            Booking.start_time <= current_time,
            Booking.end_time >= current_time
        ).first()

        if active_booking:
            return jsonify({'error': 'Slot is already booked'}), 400

        # Create new booking
        start_time = datetime.utcnow()
        duration_hours = int(data['duration_hours'])
        end_time = datetime.fromtimestamp(start_time.timestamp() + duration_hours * 3600)
        total_amount = PRICE_PER_HOUR * duration_hours
        # ensure integer amount
        total_amount = int(total_amount)

        booking = Booking(
            name=data['name'],
            vehicle_number=data['vehicle_number'].upper(),
            contact_number=data['contact_number'],
            slot_id=data['slot_id'],
            start_time=start_time,
            end_time=end_time,
            duration_hours=duration_hours,
            amount=total_amount
        )

        db.session.add(booking)
        db.session.commit()

        return jsonify({
            'id': booking.id,
            'name': booking.name,
            'vehicle_number': booking.vehicle_number,
            'slot_id': booking.slot_id,
            'start_time': booking.start_time.isoformat(),
            'end_time': booking.end_time.isoformat(),
            'duration_hours': booking.duration_hours,
            'amount': booking.amount
        })

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error in book_spot: {e}")
        return jsonify({'error': 'Failed to book spot'}), 500

@app.route('/api/user-bookings/<contact_number>')
def get_user_bookings(contact_number):
    try:
        if not validate_contact_number(contact_number):
            return jsonify({'error': 'Invalid contact number'}), 400

        bookings = Booking.query.filter_by(
            contact_number=contact_number
        ).order_by(Booking.booking_time.desc()).all()

        return jsonify({
            'bookings': [{
                'id': b.id,
                'name': b.name,
                'vehicle_number': b.vehicle_number,
                'slot_id': b.slot_id,
                'booking_time': b.booking_time.isoformat(),
                'start_time': b.start_time.isoformat(),
                'end_time': b.end_time.isoformat(),
                'duration_hours': b.duration_hours,
                'amount': b.amount,
                'payment_mode': b.payment_mode,
                'status': b.status
            } for b in bookings]
        })
    except Exception as e:
        logger.error(f"Error in get_user_bookings: {e}")
        return jsonify({'error': 'Failed to fetch bookings'}), 500

@app.route('/api/cancel-booking/<int:booking_id>', methods=['POST'])
def cancel_booking(booking_id):
    try:
        booking = Booking.query.get(booking_id)
        if not booking:
            return jsonify({'error': 'Booking not found'}), 404

        if booking.status != 'ACTIVE':
            return jsonify({'error': 'Booking cannot be cancelled'}), 400

        booking.status = 'CANCELLED'
        db.session.commit()

        return jsonify({'status': 'success'})

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error in cancel_booking: {e}")
        return jsonify({'error': 'Failed to cancel booking'}), 500

@app.route('/setup-parking')
def setup_parking():
    return render_template('setup_parking.html')

@app.route('/api/save-parking-positions', methods=['POST'])
def save_parking_positions():
    try:
        positions = request.json.get('positions')
        if not positions:
            return jsonify({'error': 'No positions provided'}), 400

        with open(PARKING_POSITIONS_FILE, 'wb') as f:
            pickle.dump(positions, f)

        # Clear existing slots and create new ones
        ParkingSlot.query.delete()
        for idx, pos in enumerate(positions):
            slot = ParkingSlot(
                id=f'P{idx+1}',
                position_x=pos[0],
                position_y=pos[1]
            )
            db.session.add(slot)
        db.session.commit()

        return jsonify({'status': 'success'})
    except Exception as e:
        logger.error(f"Error saving parking positions: {e}")
        return jsonify({'error': 'Failed to save parking positions'}), 500

@app.route('/api/sync-parking-positions', methods=['POST'])
def sync_parking_positions():
    """
    Sync parking positions from CarParkPos file with the database.
    This ensures new slots added via ParkingSpacePicker are visible in the web app.
    """
    try:
        # Load positions from CarParkPos file
        if not os.path.exists(PARKING_POSITIONS_FILE):
            return jsonify({'error': 'CarParkPos file not found'}), 404
        
        with open(PARKING_POSITIONS_FILE, 'rb') as f:
            posList = pickle.load(f)
        
        if not posList:
            return jsonify({'error': 'No positions found in CarParkPos file'}), 400
        
        # Get existing slots from database
        existing_slots = ParkingSlot.query.all()
        existing_count = len(existing_slots)
        new_count = len(posList)
        
        # Track which positions are new
        synced_slots = []
        
        if existing_count == 0:
            # Database is empty - create all new slots
            for idx, pos in enumerate(posList):
                slot = ParkingSlot(
                    id=f'P{idx+1}',
                    position_x=pos[0],
                    position_y=pos[1]
                )
                db.session.add(slot)
                synced_slots.append(f'P{idx+1}')
        else:
            # Database has existing slots - sync by adding new positions
            # Find the highest existing slot number
            max_existing = 0
            for slot in existing_slots:
                match = re.match(r'P(\d+)', slot.id)
                if match:
                    max_existing = max(max_existing, int(match.group(1)))
            
            # Add new slots for positions beyond existing count
            for idx, pos in enumerate(posList):
                if idx < existing_count:
                    # Update existing slot position
                    slot = existing_slots[idx]
                    slot.position_x = pos[0]
                    slot.position_y = pos[1]
                    synced_slots.append(slot.id)
                else:
                    # Create new slot
                    slot_num = max_existing + (idx - existing_count) + 1
                    slot = ParkingSlot(
                        id=f'P{slot_num}',
                        position_x=pos[0],
                        position_y=pos[1]
                    )
                    db.session.add(slot)
                    synced_slots.append(f'P{slot_num}')
        
        db.session.commit()
        
        logger.info(f"Synced {new_count} parking positions from CarParkPos file")
        
        return jsonify({
            'status': 'success',
            'message': f'Successfully synced {new_count} parking positions',
            'total_slots': new_count,
            'synced_slots': synced_slots
        })
        
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error syncing parking positions: {e}")
        return jsonify({'error': 'Failed to sync parking positions'}), 500

@app.route('/api/update-spot-availability/<slot_id>', methods=['POST'])
def update_spot_availability(slot_id):
    try:
        data = request.json
        new_status = data.get('status')
        
        if not new_status or new_status not in ['AVAILABLE', 'OCCUPIED']:
            return jsonify({'error': 'Invalid status'}), 400

        # Check if spot exists
        slot = ParkingSlot.query.get(slot_id)
        if not slot:
            return jsonify({'error': 'Invalid parking slot'}), 404

        # Check if spot has active booking
        current_time = datetime.utcnow()
        active_booking = Booking.query.filter_by(
            slot_id=slot_id,
            status='ACTIVE'
        ).filter(
            Booking.start_time <= current_time,
            Booking.end_time >= current_time
        ).first()

        if active_booking and new_status == 'AVAILABLE':
            return jsonify({'error': 'Cannot mark as available: spot has active booking'}), 400

        # Update spot status
        slot.status = new_status
        db.session.commit()

        return jsonify({
            'status': 'success',
            'message': f'Spot {slot_id} is now {new_status.lower()}'
        })

    except Exception as e:
        logger.error(f"Error updating spot availability: {e}")
        db.session.rollback()
        return jsonify({'error': 'Failed to update spot availability'}), 500

def init_db():
    with app.app_context():
        try:
            # Create database directory if it doesn't exist
            db_dir = os.path.dirname(app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', ''))
            if db_dir and not os.path.exists(db_dir):
                os.makedirs(db_dir)
            
            # Initialize database
            db.create_all()
            logger.info("Database initialized successfully")
            
            # Check if parking positions file exists
            if not os.path.exists(PARKING_POSITIONS_FILE):
                logger.warning(f"Parking positions file {PARKING_POSITIONS_FILE} not found")
                
            # Check if video files exist
            video_files = ['carPark.mp4', 'park.mp4']
            video_exists = any(os.path.exists(f) for f in video_files)
            if not video_exists:
                logger.warning("No video files found for parking detection")
                
        except Exception as e:
            logger.error(f"Error during initialization: {e}")
            raise

if __name__ == '__main__':
    try:
        # Initialize database
        init_db()
        
        # Start the Flask application
        app.run(host='127.0.0.1', port=8000, debug=True, threaded=True)
    except Exception as e:
        logger.error(f"Failed to start the application: {e}")
        raise 