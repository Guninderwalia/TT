import React, { useState, useEffect } from 'react';

function ManagerReviewForm({ employee, isOpen, onClose, onSave }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comments, setComments] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [existingReview, setExistingReview] = useState(null);

  useEffect(() => {
    if (isOpen && employee) {
      loadExistingReview();
    }
  }, [isOpen, employee]);

  const loadExistingReview = async () => {
    try {
      const result = await window.electron.getManagerReview(employee.id);
      if (result && result.data) {
        setExistingReview(result.data);
        setRating(result.data.rating || 0);
        setComments(result.data.comments || '');
      } else {
        resetForm();
      }
    } catch (error) {
      console.error('Error loading review:', error);
      resetForm();
    }
  };

  const resetForm = () => {
    setRating(0);
    setComments('');
    setExistingReview(null);
  };

  const handleSave = async () => {
    if (rating === 0) {
      window.toast.warning('Please select a rating (1-5 stars)');
      return;
    }

    setIsLoading(true);
    try {
      let result;
      if (existingReview) {
        result = await window.electron.updateManagerReview(
          existingReview.id,
          rating,
          comments
        );
      } else {
        result = await window.electron.createManagerReview(
          employee.id,
          rating,
          comments
        );
      }

      if (result.success) {
        window.toast.success('Review saved successfully');
        resetForm();
        onSave && onSave(result.data);
        onClose();
      } else {
        window.toast.error('Error saving review: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error saving review:', error);
      window.toast.error('Error saving review');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'var(--bg-1)',
        borderRadius: '8px',
        padding: '30px',
        maxWidth: '500px',
        width: '90%',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)'
      }}>
        <h2 style={{ marginTop: 0 }}>Manager Review - {employee?.fullName}</h2>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '10px', fontWeight: '500' }}>
            Rating (1-5 Stars)
          </label>
          <div style={{
            display: 'flex',
            gap: '10px',
            fontSize: '32px'
          }}>
            {[1, 2, 3, 4, 5].map(star => (
              <span
                key={star}
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                style={{
                  cursor: 'pointer',
                  color: star <= (hoverRating || rating) ? '#fbbf24' : '#d1d5db',
                  transition: 'color 0.2s',
                  userSelect: 'none'
                }}
              >
                ★
              </span>
            ))}
          </div>
          {rating > 0 && (
            <p style={{ marginTop: '10px', color: 'var(--text-3)' }}>
              {rating}/5 stars selected
            </p>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '10px', fontWeight: '500' }}>
            Comments (Optional)
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Add any comments about this employee's performance..."
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '10px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              fontFamily: 'inherit',
              fontSize: '14px',
              backgroundColor: 'var(--bg-2)',
              color: 'var(--text-1)',
              boxSizing: 'border-box',
              resize: 'vertical'
            }}
          />
        </div>

        <div style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'flex-end',
          paddingTop: '20px',
          borderTop: '1px solid var(--border)'
        }}>
          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              padding: '10px 20px',
              backgroundColor: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isLoading}
            style={{
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500',
              opacity: isLoading ? 0.6 : 1
            }}
          >
            {isLoading ? 'Saving...' : 'Save Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ManagerReviewForm;
