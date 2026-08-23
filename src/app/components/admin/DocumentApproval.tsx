import { useState } from 'react';
import { mockDocuments } from '../../data/mockData';
import { FileText, Check, X, Eye, MapPin, Clock } from 'lucide-react';

interface DocumentApprovalProps {
  fullView?: boolean;
}

export default function DocumentApproval({ fullView = false }: DocumentApprovalProps) {
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  
  const pendingDocs = mockDocuments.filter(d => d.status === 'Pending');
  const displayDocs = fullView ? mockDocuments : pendingDocs.slice(0, 4);

  const getDocTypeColor = (type: string) => {
    switch (type) {
      case 'POD':
        return 'bg-green-100 text-green-700';
      case 'Invoice':
        return 'bg-blue-100 text-blue-700';
      case 'Bill of Lading':
        return 'bg-purple-100 text-purple-700';
      case 'Customs':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'Approved':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'Rejected':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden h-full">
        <div className="p-6 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">Document Approval</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {pendingDocs.length} documents pending review
          </p>
        </div>

        <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
          {displayDocs.length === 0 ? (
            <div className="p-8 text-center">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No documents to review</p>
            </div>
          ) : (
            displayDocs.map((doc) => (
              <div key={doc.id} className="p-4 hover:bg-accent/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${getDocTypeColor(doc.type)}`}>
                    <FileText className="w-5 h-5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">{doc.type}</p>
                        <p className="text-xs text-muted-foreground mt-1">{doc.fileName}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border ${getStatusColor(doc.status)}`}>
                        {doc.status}
                      </span>
                    </div>
                    
                    <div className="space-y-1 mb-3">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {doc.uploadedAt}
                      </div>
                      {doc.location && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3 h-3" />
                          {doc.location}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        By: {doc.uploadedBy} • Delivery: {doc.deliveryId}
                      </p>
                    </div>

                    {doc.status === 'Pending' && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setSelectedDoc(doc.id)}
                          className="flex-1 px-3 py-1.5 bg-accent text-accent-foreground rounded-lg text-xs font-medium hover:bg-accent/80 transition-colors flex items-center justify-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          Preview
                        </button>
                        <button className="flex-1 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1">
                          <Check className="w-3 h-3" />
                          Approve
                        </button>
                        <button className="flex-1 px-3 py-1.5 bg-destructive text-white rounded-lg text-xs font-medium hover:bg-destructive/90 transition-colors flex items-center justify-center gap-1">
                          <X className="w-3 h-3" />
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {!fullView && pendingDocs.length > 4 && (
          <div className="p-4 border-t border-border bg-muted/20 text-center">
            <button className="text-sm text-primary hover:text-primary/80 font-medium">
              View All Documents →
            </button>
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {selectedDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedDoc(null)}>
          <div className="bg-white rounded-xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Document Preview</h3>
              <button onClick={() => setSelectedDoc(null)} className="p-2 hover:bg-accent rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="bg-muted/30 rounded-lg p-8 mb-4 min-h-[300px] flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Document preview would appear here</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {mockDocuments.find(d => d.id === selectedDoc)?.fileName}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors">
                Approve Document
              </button>
              <button className="flex-1 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors">
                Reject Document
              </button>
              <button onClick={() => setSelectedDoc(null)} className="px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
