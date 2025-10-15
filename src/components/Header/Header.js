import { Link } from "gatsby";
import PropTypes from "prop-types";
import React from "react";
import VisibilitySensor from "react-visibility-sensor";

import { ScreenWidthContext, FontLoadedContext } from "../../layouts";
import config from "../../../content/meta/config";
import Menu from "../Menu";

import avatar from "../../images/jpg/avatar.jpg";

class Header extends React.Component {
  state = {
    fixed: false
  };

  visibilitySensorChange = val => {
    if (val) {
      this.setState({ fixed: false });
    } else {
      this.setState({ fixed: true });
    }
  };

  getHeaderSize = () => {
    const fixed = this.state.fixed ? "fixed" : "";
    const homepage = this.props.path === "/" ? "homepage" : "";

    return `${fixed} ${homepage}`;
  };

  render() {
    const { pages, path, theme } = this.props;
    const { fixed } = this.state;

    return (
      <React.Fragment>
        <header className={`header ${this.getHeaderSize()}`}>
          <Link to="/" className="logoType">
            <div className="logo">
              <img src={config.gravatarImgMd5=="" ? avatar : config.gravatarImgMd5 } alt={config.siteTitle} />
            </div>
            <div className="type">
              <h1>{config.headerTitle}</h1>
              <h2>{config.headerSubTitle}</h2>
            </div>
          </Link>
          <FontLoadedContext.Consumer>
            {loaded => (
              <ScreenWidthContext.Consumer>
                {width => (
                  <Menu
                    path={path}
                    fixed={fixed}
                    screenWidth={width}
                    fontLoaded={loaded}
                    pages={pages}
                    theme={theme}
                  />
                )}
              </ScreenWidthContext.Consumer>
            )}
          </FontLoadedContext.Consumer>
        </header>
        <VisibilitySensor onChange={this.visibilitySensorChange}>
          <div className="sensor" />
        </VisibilitySensor>

        {/* --- STYLES --- */}
        <style jsx>{`
          .header {
            align-items: center;
            justify-content: center;
            background-color: ${theme.color.neutral.white};
            display: flex;
            height: ${theme.header.height.default};
            position: relative;
            top: 0;
            width: 100%;
            align-items: center;
          }

          .header :global(a.logoType) {
            align-items: center;
            display: flex;
            flex-direction: "column";
            color: ${theme.text.color.primary};
          }

          .header :global(a.logoType) .logo {
            flex-shrink: 0;
          }

          .header.homepage {
            position: absolute;
            background-color: transparent;
            height: ${theme.header.height.homepage};
          }

          h1 {
            font-size: ${theme.font.size.m};
            font-weight: ${theme.font.weight.standard};
            margin: ${theme.space.stack.xs};
          }

          h2 {
            font-weight: ${theme.font.weight.standard};
            font-size: ${theme.font.size.xxs};
            letter-spacing: 0;
            margin: 0;
          }

          .logo {
            border-radius: 65% 75%;
            border: 1px solid #eee;
            display: inline-block;
            height: 44px;
            margin: ${theme.space.inline.default};
            overflow: hidden;
            width: 44px;
            transition: all 0.5s;
          }

          .homepage .logo {
            height: 60px;
            width: 60px;
          }

          .logo img {
            width: 100%;
          }

          .sensor {
            display: block;
            position: absolute;
            bottom: 0;
            z-index: 1;
            left: 0;
            right: 0;
            height: 1px;
            top: ${path === "/" ? theme.header.height.homepage : theme.header.height.default};
          }

          @from-width tablet {
            .header {
              padding: ${theme.space.inset.l};
            }

            .header.homepage {
              height: ${theme.header.height.homepage};
            }
          }

          @below desktop {
            .header.homepage .logo {
              border: none;
            }

            .header.homepage :global(a.logoType),
            .header.homepage h1 {
              color: ${theme.color.neutral.white};
            }

            .header.homepage h2 {
              color: ${theme.color.neutral.gray.d};
            }
          }

          @from-width desktop {
            .header {
              align-items: center;
              background-color: ${theme.color.neutral.white};
              display: flex;
              position: absolute;
              top: 0;
              width: 100%;
              justify-content: space-between;
              transition: padding 0.5s;
            }

            .header.fixed {
              height: ${theme.header.height.fixed};
              background-color: ${theme.color.neutral.white};
              left: 0;
              padding: 0 ${theme.space.m};
              position: fixed;
              top: 0;
              width: 100%;
              z-index: 1;
            }

            .header.fixed h1 {
              margin: ${theme.space.stack.xxs};
            }

            .header.fixed h2 {
              display: none;
            }

            .header.homepage:not(.fixed) :global(a.logoType),
            .header.homepage:not(.fixed) h1 {
              color: ${theme.color.neutral.white};
            }

            .header.homepage:not(.fixed) h2 {
              color: ${theme.color.neutral.gray.d};
            }

            .header :global(a.logoType) {
              text-align: left;
              flex-direction: row;
              flex-shrink: 0;
              width: auto;
            }

            .logo {
              margin: ${theme.space.inline.default};
            }

            .fixed .logo {
              height: 36px;
              width: 36px;
            }

            .header.homepage:not(.fixed) .logo {
              border: none;
            }

            h2 {
              animation-duration: ${theme.time.duration.default};
              animation-name: h2Entry;
            }

            @keyframes h2Entry {
              from {
                opacity: 0;
              }
              to {
                opacity: 1;
              }
            }
          }
        `}</style>
      </React.Fragment>
    );
  }
}

Header.propTypes = {
  pages: PropTypes.array.isRequired,
  path: PropTypes.string.isRequired,
  theme: PropTypes.object.isRequired
};

export default Header;
