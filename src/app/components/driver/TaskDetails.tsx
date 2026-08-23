import { useState } from 'react';
import { ArrowLeft, MapPin, Phone, Package, Clock, Camera, CheckCircle, Navigation, FileText, AlertCircle } from 'lucide-react';
import { type Delivery } from '../../data/mockData';

interface TaskDetailsProps {
  task: Delivery;
  onBack: () => void;
}

export default function TaskDetails({ task, onBack }: TaskDetailsProps) {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [showUploadSuccess, setShowUploadSuccess] = useState(false);
  const currentTime = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImage(reader.result as string);
        setShowUploadSuccess(true);
        setTimeout(() => setShowUploadSuccess(false), 3000);
      };
      reader.readAsDataURL(file);
    }
  };

  const documentChecklist = [
    { name: 'Proof of Delivery (POD)', required: true, completed: task.status === 'Delivered' },
    { name: 'Customer Signature', required: true, completed: task.status === 'Delivered' },
    { name: 'Bill of Lading', required: true, completed: false },
    { name: 'Delivery Photos', required: false, completed: uploadedImage !== null },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-white border-b border-border p-4 sticky top-0 z-10">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-primary font-medium mb-3"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Tasks
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-foreground">{task.customer}</h1>
            <p className="text-sm text-muted-foreground">{task.trackingNumber}</p>
          </div>
          <span className={`text-xs px-3 py-1 rounded-full ${
            task.status === 'Delivered' 
              ? 'bg-green-100 text-green-700 border border-green-200'
              : task.status === 'In Transit'
              ? 'bg-blue-100 text-blue-700 border border-blue-200'
              : task.status === 'Delayed'
              ? 'bg-red-100 text-red-700 border border-red-200'
              : 'bg-amber-100 text-amber-700 border border-amber-200'
          }`}>
            {task.status}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Delivery Information */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Delivery Details
          </h2>

          <div className="space-y-3">
            <div className="flex items-start gap-3 pb-3 border-b border-border">
              <MapPin className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">From</p>
                <p className="text-sm text-foreground font-medium">{task.origin}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 pb-3 border-b border-border">
              <Navigation className="w-5 h-5 text-secondary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">To</p>
                <p className="text-sm text-foreground font-medium">{task.destination}</p>
                <button className="mt-2 text-xs text-secondary font-medium flex items-center gap-1">
                  Open in Maps →
                </button>
              </div>
            </div>

            <div className="flex items-start gap-3 pb-3 border-b border-border">
              <Phone className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Customer Contact</p>
                <p className="text-sm text-foreground font-medium">{task.phone}</p>
                <button className="mt-2 text-xs text-primary font-medium">Call Customer</button>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Estimated Delivery</p>
                <p className="text-sm text-foreground font-medium">
                  {new Date(task.estimatedDelivery).toLocaleString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Cargo</p>
              <p className="text-foreground font-medium">{task.cargo}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Weight</p>
              <p className="text-foreground font-medium">{task.weight}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Distance</p>
              <p className="text-foreground font-medium">{task.distance}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Priority</p>
              <p className={`font-medium ${
                task.priority === 'High' ? 'text-red-600' :
                task.priority === 'Medium' ? 'text-amber-600' : 'text-green-600'
              }`}>{task.priority}</p>
            </div>
          </div>
        </div>

        {/* Document Checklist */}
        <div className="bg-white rounded-xl border border-border shadow-sm p-4">
          <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Required Documents
          </h2>

          <div className="space-y-2">
            {documentChecklist.map((doc, index) => (
              <div
                key={index}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  doc.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-border'
                }`}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  doc.completed ? 'bg-green-500' : 'bg-gray-300'
                }`}>
                  {doc.completed && <CheckCircle className="w-4 h-4 text-white" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{doc.name}</p>
                  {doc.required && (
                    <p className="text-xs text-muted-foreground">Required</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upload Proof of Delivery */}
        {task.status !== 'Delivered' && (
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <h2 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" />
              Upload Proof of Delivery
            </h2>

            <div className="space-y-3">
              <label className="block">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="hidden"
                  id="pod-upload"
                />
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-accent/50 transition-colors">
                  <Camera className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Take Photo or Upload</p>
                  <p className="text-xs text-muted-foreground mt-1">Required for delivery completion</p>
                </div>
              </label>

              {uploadedImage && (
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <img src={uploadedImage} alt="POD" className="w-full" />
                  <button
                    onClick={() => setUploadedImage(null)}
                    className="absolute top-2 right-2 bg-destructive text-white p-2 rounded-lg text-xs"
                  >
                    Remove
                  </button>
                </div>
              )}

              {uploadedImage && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 text-sm">
                      <p className="font-medium text-green-700 mb-1">Photo Uploaded Successfully</p>
                      <div className="text-xs text-green-600 space-y-0.5">
                        <p>📅 Timestamp: {currentTime}</p>
                        <p>📍 Location: Auto-tagged</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status Update Buttons */}
        {task.status !== 'Delivered' && task.status !== 'Cancelled' && (
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <h2 className="font-semibold text-foreground mb-4">Update Status</h2>
            
            <div className="space-y-2">
              {task.status === 'Pending' && (
                <button className="w-full bg-secondary text-white py-3 rounded-lg font-medium hover:bg-secondary/90 transition-colors flex items-center justify-center gap-2">
                  <Navigation className="w-5 h-5" />
                  Start Delivery (In Transit)
                </button>
              )}
              
              {task.status === 'In Transit' && (
                <>
                  <button className="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    Arrived at Destination
                  </button>
                  <button 
                    disabled={!uploadedImage}
                    className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Package className="w-5 h-5" />
                    Mark as Delivered
                  </button>
                </>
              )}

              <button className="w-full border-2 border-destructive text-destructive py-3 rounded-lg font-medium hover:bg-destructive/10 transition-colors flex items-center justify-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Report Issue / Delay
              </button>
            </div>
          </div>
        )}

        {showUploadSuccess && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Photo uploaded successfully!</span>
          </div>
        )}
      </div>
    </div>
  );
}
