# Smart Parking Dashboard

A modern web-based dashboard for managing and monitoring parking spaces in real-time. This system combines computer vision-based parking space detection with a user-friendly booking interface.

## Features

- Real-time parking space monitoring
- Interactive parking spot selection
- Online booking system
- Duration-based pricing
- Responsive design for all devices
- Booking history tracking
- Status notifications

## Prerequisites

- Python 3.8+
- OpenCV
- Flask
- Web browser with JavaScript enabled

## Installation and run
1. Create a virtual environment and activate it:
```bash
venv\Scripts\activate
```

2. Install the required packages:
```bash
pip install -r requirements.txt
```

3. Start the Flask server:
```bash
python app.py
```

4. The dashboard will show:
   - Real-time parking space availability
   - Interactive parking spot selection
   - Booking interface with duration selection
   - Price calculation
   - Booking confirmation

## System Architecture

- Frontend: HTML5, CSS3, JavaScript
- Backend: Flask (Python)
- Database: SQLite with SQLAlchemy
- Computer Vision: OpenCV, cvzone

## API Endpoints

- GET `/api/parking-spots`: Get all parking spots with their status
- POST `/api/book-spot`: Book a parking spot
- GET `/dashboard`: View the main dashboard
- GET `/profile`: View user profile and booking history
