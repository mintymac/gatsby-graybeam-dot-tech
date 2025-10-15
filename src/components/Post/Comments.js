import React from "react";
import PropTypes from "prop-types";
import { FacebookProvider, Comments as FBComments } from "react-facebook";

import config from "../../../content/meta/config";

const Comments = props => {
  const { facebook, slug, theme } = props;
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <React.Fragment>
      <div id="post-comments" className="comments">
        {isClient && (
          <FacebookProvider appId={facebook.appId}>
            <FBComments href={`${config.siteUrl}${slug}`} width="100%" colorscheme="light" />
          </FacebookProvider>
        )}
      </div>

      {/* --- STYLES --- */}
      <style jsx>{`
        .comments {
          margin: 0 -8px ${theme.space.default};
        }
      `}</style>
    </React.Fragment>
  );
};

Comments.propTypes = {
  slug: PropTypes.string.isRequired,
  facebook: PropTypes.object.isRequired,
  theme: PropTypes.object.isRequired
};

export default Comments;
